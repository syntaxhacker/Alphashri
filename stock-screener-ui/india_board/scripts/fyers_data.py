#!/usr/bin/env python3
"""Fyers data layer for the Indian (NSE) options dashboard.

Uses the verified-working Fyers API v3 app token
(``api.orderflow_recorder.recorder_token("fyers_tbt")`` -> ``"APP_ID:TOKEN"``)
to fetch the option chain for each symbol in a hardcoded starter universe.

Fyers notes (verified):
- ``m.optionchain(data={"symbol": ..., "strikecount": N})`` returns ONE expiry
  selected with the ``timestamp`` (epoch seconds) param — omit it for the
  nearest. ``expiryData`` lists the known expiries (with ``expiry`` epoch +
  ``expiry_flag``).
- ``greeks=1`` adds per-leg ``iv/delta/gamma/theta/vega``; missing greeks are
  returned as ``None`` (never 0-filled).
- The underlying spot comes from the ``strike_price == -1`` row's ``ltp``;
  a ``quotes`` call is used as fallback.
- Saturday/Sunday = market closed, so the chain reflects Friday's OI
  snapshot. Every chain payload carries ``as_of`` (IST date) so callers can
  tell fresh vs weekend-stale data apart.
- OI is reported in raw shares (lot sizes differ per stock — no conversion).

All REST calls are paced by :mod:`fyers_pacer` (one process-wide token bucket
targeting 8 req/s and 180 req/min, with 429/``Retry-After`` handling). The
token is resolved through ``api.orderflow_recorder.recorder_token("fyers_tbt")``
and re-resolved on a cache miss or after a 401 so a stale client can never
401-loop across the ~06:00 IST daily expiry.
"""
from __future__ import annotations

import concurrent.futures as cf
import math
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

REPO_ROOT = str(Path(__file__).resolve().parent.parent.parent)
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

_SCRIPTS_DIR = str(Path(__file__).resolve().parent)
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

try:  # imported as a package submodule (india_board.scripts.fyers_data)
    from . import fyers_pacer  # type: ignore
except ImportError:  # imported top-level (india_board/scripts on sys.path)
    import fyers_pacer  # type: ignore

IST = ZoneInfo("Asia/Kolkata")


def is_market_open(now=None) -> bool:
    """True during Mon-Fri 09:15-15:30 IST.

    Delegates to :func:`fyers_pacer.is_market_open` (the single source of the
    session bounds) with a local fallback so this module never hard-depends on
    the pacer being importable.
    """
    try:
        return bool(fyers_pacer.is_market_open(now))
    except Exception:  # noqa: BLE001
        cur = now or datetime.now(IST)
        if cur.tzinfo is None:
            cur = cur.replace(tzinfo=IST)
        else:
            cur = cur.astimezone(IST)
        if cur.weekday() >= 5:
            return False
        mins = cur.hour * 60 + cur.minute
        return 9 * 60 + 15 <= mins <= 15 * 60 + 30

#: Starter universe: 2 indices + 20 liquid NSE F&O stocks.
#: Fyers equity symbols after corporate actions (Tata Motors demerged;
#: the listed PV entity trades as TMPV on Fyers).
_SYMBOL_ALIASES = {"TATAMOTORS": "TMPV"}
UNIVERSE: list[str] = [
    "NIFTY",
    "BANKNIFTY",
    "RELIANCE",
    "HDFCBANK",
    "ICICIBANK",
    "SBIN",
    "INFY",
    "TCS",
    "TATAMOTORS",
    "MARUTI",
    "AXISBANK",
    "KOTAKBANK",
    "LT",
    "TITAN",
    "SUNPHARMA",
    "ULTRACEMCO",
    "POWERGRID",
    "NTPC",
    "ONGC",
    "COALINDIA",
    "TATASTEEL",
    "ADANIENT",
    "POLICYBZR",
]

_INDICES = {"NIFTY": "NSE:NIFTY50-INDEX", "BANKNIFTY": "NSE:NIFTYBANK-INDEX"}

_SNAPSHOT_TTL = 300
_SYMBOL_TTL = 120
_CHAIN_TIMEOUT = 25

#: Cheap expiry-list call cache TTL (seconds) — expiries change at most daily.
_EXPIRIES_TTL = 600
#: Fyers ``/data/quotes`` hard limit is 50 symbols per request.
_QUOTES_BATCH = 50

_CACHE: dict[str, tuple[float, dict]] = {}
_EXPIRIES_CACHE: dict[str, tuple[float, list[dict]]] = {}
_client = None
_client_ts = 0.0
#: Optional time-based client re-resolve (0 = only on cache miss / 401).
_CLIENT_TTL = float(os.environ.get("FYERS_CLIENT_TTL_SEC", "0") or 0)

#: Closed-market one-shot guards. When the market is closed and no cache
#: exists we allow exactly one exempt rebuild per IST day (per ticker for the
#: drill-down); later calls never refetch, so a failed capture cannot loop the
#: Fyers API off-hours.
_closed_snapshot_day: str | None = None
#: Earliest epoch when a *failed* closed-session capture may be retried.
#: A Cloudflare/throttle failure must not leave the board empty all night: once
#: the pause latch expires the next request retries (after this short cooldown).
_closed_snapshot_retry_after: float = 0.0
_closed_symbol_attempts: set = set()


def fyers_symbol(ticker: str) -> str:
    """Map a universe ticker to its Fyers symbol."""
    t = (ticker or "").upper().strip()
    if t in _INDICES:
        return _INDICES[t]
    return f"NSE:{_SYMBOL_ALIASES.get(t, t)}-EQ"


def _build_client():
    """Construct a fresh authenticated FyersModel with a paced session."""
    from api.orderflow_recorder import recorder_token

    from fyers_apiv3.fyersModel import FyersModel

    combined = recorder_token("fyers_tbt")
    app_id, _, token = (combined or "").partition(":")
    if not app_id or not token:
        raise RuntimeError("fyers_tbt token not available (expected 'APP_ID:TOKEN')")
    client = FyersModel(client_id=app_id, token=token)
    # Route every SDK REST call through the process-wide pacer without the SDK
    # knowing. Falls back to the raw session if the SDK shape ever changes.
    try:
        client.service.session = fyers_pacer.PacedSession(client.service.session)
    except Exception:  # noqa: BLE001 - never block on a pacer wiring failure
        pass
    return client


def _invalidate_client() -> None:
    """Drop the cached client so the next call re-resolves the token."""
    global _client, _client_ts
    _client = None
    _client_ts = 0.0


def _get_client(force_refresh: bool = False):
    """Authenticated FyersModel, re-resolved on cache miss / after a 401.

    Token is never logged. ``force_refresh`` bypasses the cache so a token
    rotated at ~06:00 IST is picked up instead of 401-looping on a dead client.
    """
    global _client, _client_ts
    now = time.time()
    if _client is not None and not force_refresh:
        if _CLIENT_TTL <= 0 or (now - _client_ts) < _CLIENT_TTL:
            return _client
    _client = _build_client()
    _client_ts = now
    return _client


#: Gap between tickers inside a rebuild. Cloudflare 1015 is burst-triggered,
#: so this is deliberately slower than the theoretical API capability.
_REBUILD_GAP = 0.8

#: Auth-failure latch: a dead token makes every Fyers call 401, so sweeps must
#: stop instead of grinding through hundreds of doomed requests. Short TTL so a
#: re-authenticated token is picked up promptly.
_AUTH_STATE: dict = {"failed_at": 0.0, "count": 0}
_AUTH_TTL_SEC = 900


def note_auth_failure() -> None:
    """Record a dead/expired token (thread-safe enough for a monotonic latch)."""
    _AUTH_STATE["failed_at"] = time.time()
    _AUTH_STATE["count"] = int(_AUTH_STATE.get("count", 0)) + 1


def note_auth_success() -> None:
    """Clear the latch after any successful call."""
    if _AUTH_STATE.get("count"):
        _AUTH_STATE["count"] = 0
        _AUTH_STATE["failed_at"] = 0.0


def auth_failed(ttl: int = _AUTH_TTL_SEC) -> bool:
    """True when the token failed within the last ``ttl`` seconds."""
    at = float(_AUTH_STATE.get("failed_at") or 0.0)
    return bool(at) and (time.time() - at) < ttl


def auth_failure_count() -> int:
    """Consecutive-ish auth failures since the last success (for diagnostics)."""
    return int(_AUTH_STATE.get("count") or 0)


def fyers_paused() -> bool:
    """True when Fyers calls cannot succeed right now.

    Covers both a dead token (needs re-auth) and a hard rate-limit/WAF ban
    (Cloudflare 1015). Sweeps must check this and stop instead of grinding.
    """
    return auth_failed() or fyers_pacer.rate_limited()


def pause_reason() -> str | None:
    """Human-readable reason string when :func:`fyers_paused`, else ``None``."""
    if fyers_pacer.rate_limited():
        mins = int(fyers_pacer.rate_limit_remaining() // 60) + 1
        return f"Fyers rate-limited (Cloudflare 1015) — resumes in ~{mins} min"
    if auth_failed():
        return "Fyers token expired — re-authenticate to resume data"
    return None


def _looks_like_auth_error(value) -> bool:
    """Heuristic for SDK-raised errors/strings that mean 'token is dead'."""
    text = str(value or "").lower()
    if not text:
        return False
    if "401" in text:
        return True
    return "auth" in text or ("token" in text and any(w in text for w in ("expir", "invalid", "not valid")))


def _is_auth_error(resp) -> bool:
    """True when a Fyers response dict reports a dead/expired token."""
    if not isinstance(resp, dict):
        return False
    if resp.get("code") in (401, -401):
        return True
    msg = str(resp.get("message") or "").lower()
    return "token" in msg and any(w in msg for w in ("expir", "invalid", "not valid"))


def _call_with_reauth(fn):
    """Call ``fn(client)``; on an auth error re-resolve the token and retry once.

    Prevents the stale-client 401 loop across the daily token expiry.

    Also refuses **before any network I/O** when the market is closed and the
    caller has not opted in with ``fyers_pacer.allow_offhours(...)``: without
    this the pacer's block surfaces as an opaque Fyers ``-99 Bad request``
    because the SDK swallows the transport-level refusal.
    """
    # Same enforcement the pacer applies internally (respects the
    # FYERS_OFFHOURS_BLOCK arming + the calling thread's exemption), but raised
    # here so the failure is a clear "market closed" instead of an SDK-level
    # "optionchain failed: -99 Bad request".
    fyers_pacer.enforce_offhours()
    client = _get_client()
    try:
        resp = fn(client)
    except fyers_pacer.FyersAuthError:
        _invalidate_client()
        return fn(_get_client(force_refresh=True))
    except Exception as exc:  # noqa: BLE001 - the SDK raises on 401
        if _looks_like_auth_error(exc):
            note_auth_failure()
        raise
    if _is_auth_error(resp):
        _invalidate_client()
        resp = fn(_get_client(force_refresh=True))
        # Still an auth error after a fresh token ⇒ the stored token itself is
        # dead (needs an interactive re-auth). Latch it so sweeps abort early.
        if _is_auth_error(resp):
            note_auth_failure()
        else:
            note_auth_success()
        return resp
    note_auth_success()
    return resp


def _num(v, default: float = 0.0) -> float:
    try:
        if v is None:
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


def _num_opt(v) -> float | None:
    """Float or ``None`` — never fabricates a 0 for a missing value."""
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float("inf"), float("-inf")):
        return None
    return f


def _to_int(v) -> int | None:
    """Best-effort int (epoch), else ``None``."""
    if v is None or isinstance(v, bool):
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return None


def _epoch_to_iso(epoch) -> str | None:
    try:
        return datetime.fromtimestamp(int(epoch), tz=IST).date().isoformat()
    except (TypeError, ValueError, OSError, OverflowError):
        return None


def _norm_expiry_flag(v) -> str | None:
    """Normalise ``expiry_flag`` to ``"W"``/``"M"`` when determinable."""
    if v is None:
        return None
    s = str(v).strip().upper()
    if s in ("W", "M"):
        return s
    # Older/alternate payloads encode weekly/monthly as "1"/"0".
    if s == "1":
        return "W"
    if s == "0":
        return "M"
    return None


def _expiry_date_str(raw_date, raw_exp) -> str | None:
    """Human date string for one ``expiryData`` entry (ISO fallback)."""
    if raw_date is not None:
        s = str(raw_date).strip()
        if s:
            if s.isdigit():
                return _epoch_to_iso(s) or s
            return s
    if raw_exp is not None:
        if isinstance(raw_exp, (int, float)) or str(raw_exp).strip().isdigit():
            return _epoch_to_iso(raw_exp)
        return str(raw_exp)
    return None


def _expiry_entries(data: dict) -> list[dict]:
    """Structured ``[{date, expiry, expiry_flag}]`` from a chain payload."""
    entries: list[dict] = []
    for e in data.get("expiryData") or []:
        if isinstance(e, dict):
            raw_date, raw_exp, raw_flag = (
                e.get("date"),
                e.get("expiry"),
                e.get("expiry_flag"),
            )
        else:
            raw_date, raw_exp, raw_flag = None, e, None
        date_str = _expiry_date_str(raw_date, raw_exp)
        epoch = _to_int(raw_exp)
        if date_str is None and epoch is None:
            continue
        entries.append(
            {
                "date": date_str,
                "expiry": epoch,
                "expiry_flag": _norm_expiry_flag(raw_flag),
            }
        )
    # Nearest first (epoch ascending); entries without an epoch keep order last.
    entries.sort(key=lambda e: (e["expiry"] is None, e["expiry"] or 0))
    return entries


def _extract_indiavix(data: dict) -> float | None:
    """Numeric India VIX from ``indiavixData`` (dict or scalar), else None."""
    ivx = data.get("indiavixData")
    if ivx is None:
        return None
    if isinstance(ivx, dict):
        for key in ("iv", "indiavix", "value", "ltp", "close", "last", "vix"):
            if ivx.get(key) is not None:
                n = _num_opt(ivx.get(key))
                if n is not None:
                    return n
        for value in ivx.values():
            n = _num_opt(value)
            if n is not None:
                return n
        return None
    return _num_opt(ivx)


def _quote_spot(client, symbol: str) -> tuple[float | None, float | None]:
    """Fallback spot (+ change %) via the quotes endpoint."""
    try:
        resp = client.quotes(data={"symbols": symbol})
    except Exception:  # noqa: BLE001
        return None, None
    if not isinstance(resp, dict) or resp.get("s") not in ("ok", "OK"):
        return None, None
    rows = resp.get("d") or resp.get("data") or []
    if not rows:
        return None, None
    q = rows[0] if isinstance(rows, list) else rows
    v = q.get("v", q) if isinstance(q, dict) else {}
    ltp = _num(v.get("lp", v.get("ltp")), default=float("nan"))
    chp = _num(v.get("chp"), default=float("nan"))
    spot = None if ltp != ltp else ltp  # NaN check
    chg = None if chp != chp else chp
    return spot, chg


def get_chain(ticker: str, *, expiry_epoch=None, greeks: bool = False,
              strikecount: int = 50) -> dict:
    """Fetch an option chain for ``ticker`` and reshape it (FROZEN W1a interface).

    Args:
        ticker: universe ticker (e.g. ``"NIFTY"`` / ``"RELIANCE"``) or a raw
            Fyers symbol (``"NSE:RELIANCE-EQ"``).
        expiry_epoch: epoch seconds (str or int) selecting that expiry via the
            Fyers ``timestamp`` param. Omit/``None`` for the nearest expiry.
        greeks: pass ``greeks=1`` so each leg also carries
            ``ce_iv/ce_delta/ce_gamma/ce_theta/ce_vega`` (and ``pe_*``). Missing
            greeks are ``None`` — never 0-filled.
        strikecount: Fyers strike count (default 50 = Fyers max).

    Returns a dict with existing keys ``ticker, spot, strikes, expiries,
    call_oi, put_oi, as_of`` plus ``expiry`` (selected expiry date string),
    ``expiry_flag`` (``"W"``/``"M"`` when determinable) and ``indiavix`` (when
    the response carries ``indiavixData``).

    Each strike row carries ``strike, ce_oi, pe_oi, ce_oich, pe_oich, ce_vol,
    pe_vol, ce_ltp, pe_ltp, ce_bid, ce_ask, pe_bid, pe_ask, ce_prev_oi,
    pe_prev_oi, ce_oichp, pe_oichp`` plus the per-leg greeks when requested.
    Sorted by strike; OI quantities are raw shares.
    """
    t = (ticker or "").upper().strip()
    symbol = fyers_symbol(t)

    payload: dict = {"symbol": symbol, "strikecount": int(strikecount)}
    if expiry_epoch is not None and str(expiry_epoch).strip() != "":
        epoch = _to_int(expiry_epoch)
        payload["timestamp"] = epoch if epoch is not None else expiry_epoch
    if greeks:
        payload["greeks"] = 1

    resp = _call_with_reauth(lambda client: client.optionchain(data=payload))
    if not isinstance(resp, dict) or resp.get("s") != "ok":
        raise RuntimeError(f"optionchain failed for {t}: {resp!r}"[:300])
    data = resp.get("data") or {}

    rows = data.get("optionsChain") or []
    spot: float | None = None
    spot_chg: float | None = None
    by_strike: dict[float, dict] = {}
    for r in rows:
        if not isinstance(r, dict):
            continue
        strike = _num(r.get("strike_price"), default=float("nan"))
        if strike != strike:  # NaN
            continue
        if strike == -1:
            # Underlying row: ltp is the spot price, ltpchp the day change %.
            # Taking the change from here avoids /data/quotes entirely — that
            # endpoint is what Cloudflare throttles (1015) while chains work.
            spot = _num_opt(r.get("ltp"))
            spot_chg = _num_opt(r.get("ltpchp"))
            continue
        leg = by_strike.setdefault(
            strike,
            {
                "strike": strike,
                "ce_oi": 0.0, "pe_oi": 0.0,
                "ce_oich": 0.0, "pe_oich": 0.0,
                "ce_vol": 0.0, "pe_vol": 0.0,
                "ce_ltp": 0.0, "pe_ltp": 0.0,
                "ce_bid": None, "ce_ask": None,
                "pe_bid": None, "pe_ask": None,
                "ce_prev_oi": None, "pe_prev_oi": None,
                "ce_oichp": None, "pe_oichp": None,
                "ce_iv": None, "pe_iv": None,
                "ce_delta": None, "pe_delta": None,
                "ce_gamma": None, "pe_gamma": None,
                "ce_theta": None, "pe_theta": None,
                "ce_vega": None, "pe_vega": None,
            },
        )
        side = str(r.get("option_type") or "").upper()
        prefix = "ce_" if side == "CE" else "pe_" if side == "PE" else None
        if prefix is None:
            continue
        leg[f"{prefix}oi"] = _num(r.get("oi"))
        leg[f"{prefix}oich"] = _num(r.get("oich"))
        leg[f"{prefix}vol"] = _num(r.get("volume"))
        leg[f"{prefix}ltp"] = _num(r.get("ltp"))
        leg[f"{prefix}bid"] = _num_opt(r.get("bid"))
        leg[f"{prefix}ask"] = _num_opt(r.get("ask"))
        leg[f"{prefix}prev_oi"] = _num_opt(
            r.get("prev_oi", r.get("prevOi", r.get("prev_oi_count")))
        )
        leg[f"{prefix}oichp"] = _num_opt(r.get("oichp"))
        # Fyers nests greeks per leg: {"delta","gamma","theta","vega","iv"}.
        # (Flat keys are tolerated as a fallback in case Fyers flattens them.)
        greeks_block = r.get("greeks") if isinstance(r.get("greeks"), dict) else {}
        for greek_key in ("iv", "delta", "gamma", "theta", "vega"):
            leg[f"{prefix}{greek_key}"] = _num_opt(
                greeks_block.get(greek_key, r.get(greek_key))
            )

    strikes = [by_strike[k] for k in sorted(by_strike)]

    expiry_entries = _expiry_entries(data)
    expiries = [e["date"] for e in expiry_entries if e["date"]]

    selected = None
    want = _to_int(expiry_epoch)
    if want is not None:
        for entry in expiry_entries:
            if entry["expiry"] == want:
                selected = entry
                break
    if selected is None and expiry_entries:
        selected = expiry_entries[0]

    if spot is None:
        spot, _ = _quote_spot(_get_client(), symbol)

    return {
        "ticker": t,
        "spot": spot,
        "spot_chg_pct": spot_chg,
        "strikes": strikes,
        "expiries": expiries,
        "call_oi": _num(data.get("callOi")),
        "put_oi": _num(data.get("putOi")),
        # IST calendar date of this snapshot; on Sat/Sun this is Friday's OI.
        "as_of": datetime.now(IST).date().isoformat(),
        "expiry": selected["date"] if selected else None,
        "expiry_flag": selected["expiry_flag"] if selected else None,
        "indiavix": _extract_indiavix(data),
    }


def list_expiries(ticker: str) -> list[dict]:
    """Known expiries for ``ticker`` as ``[{date, expiry, expiry_flag}]``.

    Uses a cheap ``strikecount=1`` chain call (cached ~10 min), nearest first.
    Raises on a Fyers error so callers can surface a clear reason.
    """
    t = (ticker or "").upper().strip()
    now = time.time()
    hit = _EXPIRIES_CACHE.get(t)
    if hit and now - hit[0] < _EXPIRIES_TTL:
        return [dict(e) for e in hit[1]]

    symbol = fyers_symbol(t)
    resp = _call_with_reauth(
        lambda client: client.optionchain(
            data={"symbol": symbol, "strikecount": 1}
        )
    )
    if not isinstance(resp, dict) or resp.get("s") != "ok":
        raise RuntimeError(f"expiry list failed for {t}: {resp!r}"[:300])
    entries = _expiry_entries(resp.get("data") or {})
    _EXPIRIES_CACHE[t] = (time.time(), entries)
    return [dict(e) for e in entries]


def get_quotes(symbols: list[str]) -> dict[str, dict]:
    """Batch quotes (50 symbols per request) keyed by the requested symbols.

    Each value is ``{"ltp","ch","chp","volume","oi"}``; any missing field is
    ``None`` (never fabricated). Inputs may be universe tickers or raw Fyers
    symbols; the returned keys match the inputs.
    """
    out: dict[str, dict] = {}
    requested = [str(s) for s in (symbols or []) if s]
    if not requested:
        return out

    reverse: dict[str, str] = {}
    fyers_symbols: list[str] = []
    for raw in requested:
        fs = raw if ":" in raw else fyers_symbol(raw)
        fyers_symbols.append(fs)
        reverse.setdefault(fs, raw)

    for i in range(0, len(fyers_symbols), _QUOTES_BATCH):
        batch = fyers_symbols[i:i + _QUOTES_BATCH]
        resp = _call_with_reauth(
            lambda client, b=",".join(batch): client.quotes(data={"symbols": b})
        )
        rows = []
        if isinstance(resp, dict) and resp.get("s") in ("ok", "OK"):
            data = resp.get("d") or resp.get("data")
            if isinstance(data, list):
                rows = data
            elif isinstance(data, dict):
                rows = [data]
        for row in rows:
            if not isinstance(row, dict):
                continue
            name = row.get("n") or row.get("symbol") or row.get("name")
            v = row.get("v")
            if not isinstance(v, dict):
                v = row
            key = reverse.get(str(name)) if name is not None else None
            if key is None:
                continue
            out[key] = {
                "ltp": _num_opt(v.get("lp", v.get("ltp"))),
                "ch": _num_opt(v.get("ch")),
                "chp": _num_opt(v.get("chp")),
                "volume": _num_opt(v.get("volume", v.get("vol"))),
                "oi": _num_opt(v.get("oi")),
            }

    # Deterministic keys: requested-but-missing symbols read as all-None.
    for raw in requested:
        out.setdefault(
            raw, {"ltp": None, "ch": None, "chp": None, "volume": None, "oi": None}
        )
    return out


def get_history(symbol: str, resolution, range_from, range_to, *,
                oi_flag: bool = False) -> list[list]:
    """OHLC(V[,OI]) candles from Fyers ``/data/history``.

    Wraps the Fyers params ``date_format=1`` (``range_from``/``range_to`` as
    ``YYYY-MM-DD``), ``cont_flag=1`` and ``oi_flag=1`` when requested. Returns
    the raw ``candles`` list (``[[epoch, o, h, l, c, v, (oi)], ...]``).
    """
    sym = symbol if ":" in str(symbol or "") else fyers_symbol(symbol)
    data: dict = {
        "symbol": sym,
        "resolution": str(resolution),
        "date_format": 1,
        "range_from": range_from,
        "range_to": range_to,
        "cont_flag": 1,
    }
    if oi_flag:
        data["oi_flag"] = 1
    resp = _call_with_reauth(lambda client: client.history(data=data))
    if not isinstance(resp, dict) or resp.get("s") not in ("ok", "OK"):
        raise RuntimeError(f"history failed for {symbol}: {resp!r}"[:300])
    candles = resp.get("candles")
    return candles if isinstance(candles, list) else []


def compute_levels(chain: dict) -> dict:
    """Derive PCR, max pain, top-OI strikes, support and resistance."""
    strikes = chain.get("strikes") or []
    spot = chain.get("spot")
    call_oi = _num(chain.get("call_oi")) or sum(_num(s.get("ce_oi")) for s in strikes)
    put_oi = _num(chain.get("put_oi")) or sum(_num(s.get("pe_oi")) for s in strikes)

    pcr = (put_oi / call_oi) if call_oi else None

    # Max pain: candidate expiry price minimizing total writer payout,
    # i.e. sum(max(0, S-k)*ce_oi + max(0, k-S)*pe_oi) over strikes.
    max_pain = None
    if strikes:
        best: float | None = None
        for cand in strikes:
            s = _num(cand.get("strike"))
            total = 0.0
            for row in strikes:
                k = _num(row.get("strike"))
                total += max(0.0, s - k) * _num(row.get("ce_oi"))
                total += max(0.0, k - s) * _num(row.get("pe_oi"))
            if best is None or total < best:
                best = total
                max_pain = s

    by_call = sorted(strikes, key=lambda r: _num(r.get("ce_oi")), reverse=True)
    by_put = sorted(strikes, key=lambda r: _num(r.get("pe_oi")), reverse=True)
    top_call = [_num(r.get("strike")) for r in by_call[:5]]
    top_put = [_num(r.get("strike")) for r in by_put[:5]]

    support = resistance = None
    if spot is not None and strikes:
        below = [r for r in strikes if _num(r.get("strike")) < spot]
        above = [r for r in strikes if _num(r.get("strike")) > spot]
        if below:
            support = _num(max(below, key=lambda r: _num(r.get("pe_oi"))).get("strike"))
        if above:
            resistance = _num(max(above, key=lambda r: _num(r.get("ce_oi"))).get("strike"))

    return {
        "pcr": pcr,
        "max_pain": max_pain,
        "top_call_oi": top_call,
        "top_put_oi": top_put,
        "support": support,
        "resistance": resistance,
    }


def _leader_row(ticker: str) -> dict | None:
    """One universe row for build_snapshot(); None on any failure."""
    try:
        chain = get_chain(ticker)
        levels = compute_levels(chain)
    except Exception:  # noqa: BLE001
        return None
    return {
        "ticker": ticker,
        "last": chain.get("spot"),
        "pcr": levels.get("pcr"),
        "max_pain": levels.get("max_pain"),
        "resistance": levels.get("resistance"),
        "support": levels.get("support"),
        "top_call_oi_strike": (levels.get("top_call_oi") or [None])[0],
        "top_put_oi_strike": (levels.get("top_put_oi") or [None])[0],
        "total_oi": (chain.get("call_oi") or 0) + (chain.get("put_oi") or 0),
    }


def _index_row(ticker: str) -> dict:
    """Index header row with last + day change % (failures -> Nones)."""
    last: float | None = None
    chg: float | None = None
    try:
        chain = get_chain(ticker)
        last = chain.get("spot")
        chg = chain.get("spot_chg_pct")
    except Exception:  # noqa: BLE001
        pass
    if chg is None:
        # Quotes are optional: only reached when the chain lacked the change
        # (or failed entirely). /data/quotes is the Cloudflare-throttled path.
        try:
            q_last, q_chg = _quote_spot(_get_client(), fyers_symbol(ticker))
            last = last if last is not None else q_last
            chg = q_chg
        except Exception:  # noqa: BLE001
            pass
    return {"ticker": ticker, "last": last, "chg_pct": chg}


def _tape_sections() -> dict:
    """Tape + opportunities sections from the universe scan.

    The universe scan (``scan_data``) is the only place with per-strike volume
    deltas across the market, so the home snapshot borrows its two NSE
    analogues of the US board's "prints"/"sweeps" cards. ``build_scan()`` never
    blocks for minutes and never raises, and a missing/older payload simply
    contributes nothing.
    """
    try:
        import scan_data  # lazy: scan_data imports fyers_data at module level

        # Read-only: never kick a fresh 210-underlying scan from a snapshot
        # build. The scan scheduler owns scan freshness; this only borrows the
        # last-good tape/opportunities sections.
        sections = (scan_data.cached_scan(trigger=False) or {}).get("sections") or {}
    except Exception:  # noqa: BLE001
        return {}
    return {
        key: sections[key]
        for key in ("tape", "opportunities")
        if isinstance(sections.get(key), dict)
    }


def _with_tape(payload: dict) -> dict:
    """Shallow copy of ``payload`` with freshly merged tape sections."""
    extra = _tape_sections()
    if not extra:
        return payload
    out = dict(payload)
    out["sections"] = {**(payload.get("sections") or {}), **extra}
    return out


def _rebuild_snapshot() -> dict:
    """Fetch + reshape the universe snapshot (no off-hours gate here).

    Fetches concurrently (max 4 workers, 25s per ticker), skips failures, and
    caches for 300s. Callers decide *whether* a rebuild is allowed (see
    :func:`build_snapshot`).
    """
    stocks = [t for t in UNIVERSE if t not in _INDICES]
    # Sequential with a small gap: the Fyers chain endpoint rate-limits
    # concurrent bursts (parallel fetch returned only ~8/20). ~15s cold,
    # served from the 300s cache afterwards.
    # Indices are fetched SEQUENTIALLY: firing them concurrently made them the
    # rebuild's first burst, which is what Cloudflare 1015 throttles (chains in
    # isolation succeed, the concurrent pair did not).
    indices = []
    for t in _INDICES:
        try:
            indices.append(_index_row(t))
        except Exception:  # noqa: BLE001
            indices.append({"ticker": t, "last": None, "chg_pct": None})
        time.sleep(_REBUILD_GAP)
    leaders = {}
    for i, t in enumerate(stocks):
        # Circuit breaker: a dead token fails every call, so abort the sweep
        # instead of grinding through the whole universe.
        if i >= 2 and fyers_paused():
            print(
                f"[fyers] aborting snapshot rebuild after {i} tickers — {pause_reason()}",
                flush=True,
            )
            break
        try:
            row = _leader_row(t)
        except Exception:  # noqa: BLE001
            row = None
        if row is None:
            time.sleep(1.0)
            try:
                row = _leader_row(t)
            except Exception:  # noqa: BLE001
                row = None
        if row is not None:
            leaders[t] = row
        time.sleep(_REBUILD_GAP)

    # If the rebuild yielded no leaders (expired token, rate limits), keep
    # serving the last good board instead of an empty one.
    if not leaders:
        hit = _CACHE.get("snapshot")
        if hit:
            old = dict(hit[1])
            old["stale"] = True
            # Always pair stale with a status so the UI can tell a failed
            # rebuild apart from a closed market (which is also not fresh).
            old["data_status"] = "rebuild_failed"
            return _with_tape(old)

    payload = {
        "generated_at": datetime.now(IST).isoformat(),
        # leaders as a list (sorted by total OI desc) — the home view slices it.
        "sections": {
            "indices": indices,
            "leaders": sorted(leaders.values(), key=lambda r: r.get("total_oi") or 0, reverse=True),
        },
    }
    payload["sections"].update(_tape_sections())
    # Never cache an empty board — a failed rebuild must not poison the cache,
    # or the stale-serving fallback above can never engage.
    if payload["sections"]["leaders"]:
        _CACHE["snapshot"] = (time.time(), payload)
    return payload


def build_snapshot() -> dict:
    """Universe snapshot: index headers + per-ticker OI leaders.

    Fresh cache -> returned as-is. When the market is **closed** the board is
    served from cache at any age and flagged ``data_status: "market_closed"``
    (never a rebuild on a 60s page refresh); a closed board with no cache is
    rebuilt exactly once per day inside an :func:`fyers_pacer.allow_offhours`
    exemption and then served from that cache. During market hours a stale
    cache triggers a normal rebuild.
    """
    global _closed_snapshot_day, _closed_snapshot_retry_after
    now = time.time()
    hit = _CACHE.get("snapshot")
    if fyers_paused():
        # Dead token (401) or a hard rate-limit/WAF ban: every call would fail
        # or hang. Never spend 20+ doomed requests per page load — serve
        # last-good (flagged) or an explicit empty board the UI can explain.
        status = "feed_rate_limited" if fyers_pacer.rate_limited() else "feed_auth_failed"
        reason = pause_reason()
        if hit is not None:
            payload = dict(hit[1])
            payload["stale"] = True
            payload["data_status"] = status
            payload["reason"] = reason
            return _with_tape(payload)
        return {
            "generated_at": None,
            "sections": {"indices": [], "leaders": []},
            "data_status": status,
            "reason": reason,
        }
    if not is_market_open():
        if hit is not None:
            payload = dict(hit[1])
            payload["data_status"] = "market_closed"
            return payload
        today = datetime.now(IST).date().isoformat()
        if _closed_snapshot_day == today and time.time() < _closed_snapshot_retry_after:
            # Today's capture already ran (successfully, or recently failed);
            # do not refetch off-hours until the cooldown allows a retry.
            return {
                "generated_at": None,
                "sections": {"indices": [], "leaders": []},
                "data_status": (
                    "feed_rate_limited" if fyers_pacer.rate_limited()
                    else "feed_auth_failed" if auth_failed()
                    else "market_closed"
                ),
                "reason": pause_reason(),
            }
        # No cache yet: capture the closed session once, then serve it. If the
        # capture fails (token/rate limit) keep the day open for a later retry
        # instead of leaving the board blank until the next session.
        _closed_snapshot_day = today
        with fyers_pacer.allow_offhours("snapshot-closed-once"):
            built = _rebuild_snapshot()
        got_leaders = bool((built.get("sections") or {}).get("leaders"))
        _closed_snapshot_retry_after = 0.0 if got_leaders else time.time() + 300
        out = dict(built)
        # A failed/empty closed capture must say WHY — "market closed" alone
        # would make a dead token or a Cloudflare ban look like normal
        # off-hours behaviour.
        if fyers_paused() and not (out.get("sections") or {}).get("leaders"):
            out["data_status"] = (
                "feed_rate_limited" if fyers_pacer.rate_limited() else "feed_auth_failed"
            )
            out["reason"] = pause_reason()
        else:
            out["data_status"] = "market_closed"
        return out
    if hit and now - hit[0] < _SNAPSHOT_TTL:
        return _with_tape(hit[1])
    return _rebuild_snapshot()


def _rebuild_symbol(t: str) -> dict:
    """Fetch + reshape one ticker's drill-down (no off-hours gate here)."""
    ck = f"symbol:{t}"
    hit = _CACHE.get(ck)
    try:
        chain = get_chain(t)
    except Exception:  # noqa: BLE001
        if hit:
            old = dict(hit[1])
            old["stale"] = True
            old["data_status"] = "rebuild_failed"
            return old
        raise
    exp = (chain.get("expiries") or [""])[0]
    payload = {
        "ticker": t,
        "spot": chain.get("spot"),
        "call_oi": chain.get("call_oi"),
        "put_oi": chain.get("put_oi"),
        "as_of": chain.get("as_of"),
        "chain": {"expiry": exp, "strikes": chain.get("strikes")},
        "levels": compute_levels(chain),
        "expiries": chain.get("expiries"),
    }
    _CACHE[ck] = (time.time(), payload)
    return payload


def build_symbol(ticker: str) -> dict:
    """Drill-down bundle for one ticker. Cached 120s during the session.

    When the market is closed an existing cache entry is served regardless of
    TTL (flagged ``data_status: "market_closed"``); with no cache the drill-down
    is fetched exactly once via an off-hours exemption and then cached.
    """
    t = (ticker or "").upper().strip()
    ck = f"symbol:{t}"
    if not is_market_open():
        hit = _CACHE.get(ck)
        if hit is not None:
            payload = dict(hit[1])
            payload["data_status"] = "market_closed"
            return payload
        today = datetime.now(IST).date().isoformat()
        if (today, t) in _closed_symbol_attempts:
            # Already tried the single closed-session fetch today (and it left
            # nothing cached); never refetch off-hours.
            raise RuntimeError(f"market closed: no cached drill-down for {t}")
        _closed_symbol_attempts.add((today, t))
        with fyers_pacer.allow_offhours("symbol-closed-once"):
            built = _rebuild_symbol(t)
        out = dict(built)
        out["data_status"] = "market_closed"
        return out
    now = time.time()
    hit = _CACHE.get(ck)
    if hit and now - hit[0] < _SYMBOL_TTL:
        return hit[1]
    return _rebuild_symbol(t)


def search_symbols(q: str, limit: int = 20) -> list[str]:
    """Substring match over the universe; always also offer the raw typed
    ticker itself (validated live against Fyers by build_symbol), so any NSE
    symbol like POLICYBZR is searchable even when not in the universe."""
    query = (q or "").strip().upper()
    if not query:
        return list(UNIVERSE[:limit])
    starts = [t for t in UNIVERSE if t.startswith(query)]
    contains = [t for t in UNIVERSE if query in t and not t.startswith(query)]
    out = starts + contains
    if query not in out and len(query) >= 2:
        out.append(query)
    return out[:limit]


# ---- futures + gamma exposure -------------------------------------------
#: Risk-free rate assumed for the Black-Scholes gamma estimate (91-day T-bill
#: ballpark). Only affects the GEX approximation, nothing tradeable.
_RISK_FREE = 0.065


def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _norm_pdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def _bs_price(s: float, k: float, t: float, r: float, sig: float, cp: str) -> float:
    """Black-Scholes price. T in years, sig as a decimal."""
    if t <= 0 or sig <= 0 or s <= 0 or k <= 0:
        return max(0.0, (s - k) if cp == "call" else (k - s))
    d1 = (math.log(s / k) + (r + 0.5 * sig * sig) * t) / (sig * math.sqrt(t))
    d2 = d1 - sig * math.sqrt(t)
    disc = math.exp(-r * t)
    if cp == "call":
        return s * _norm_cdf(d1) - k * disc * _norm_cdf(d2)
    return k * disc * _norm_cdf(-d2) - s * _norm_cdf(-d1)


def _implied_vol(price: float, s: float, k: float, t: float, cp: str) -> float | None:
    """Back out IV by bisection. None when the price admits no solution."""
    if price <= 0 or s <= 0 or k <= 0 or t <= 0:
        return None
    intrinsic = max(0.0, (s - k) if cp == "call" else (k - s))
    if price < intrinsic * 0.999:
        return None
    lo, hi = 1e-4, 5.0
    if _bs_price(s, k, t, _RISK_FREE, hi, cp) < price:
        return None
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        if _bs_price(s, k, t, _RISK_FREE, mid, cp) < price:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def _bs_gamma(s: float, k: float, t: float, sig: float) -> float:
    if t <= 0 or sig <= 0 or s <= 0 or k <= 0:
        return 0.0
    d1 = (math.log(s / k) + (_RISK_FREE + 0.5 * sig * sig) * t) / (sig * math.sqrt(t))
    return _norm_pdf(d1) / (s * sig * math.sqrt(t))


def _chain_dte_days(chain: dict) -> int:
    """Days to the chain's (nearest) expiry. Fyers dates are 'DD-MM-YYYY'."""
    for raw in chain.get("expiries") or []:
        try:
            exp = datetime.strptime(str(raw), "%d-%m-%Y").date()
            return max(0, (exp - datetime.now(IST).date()).days)
        except (ValueError, TypeError):
            continue
    return 7


def _get_futures_chain(ticker: str) -> list[dict]:
    """Raw futures_chain rows for a ticker (underlying row has no expiry)."""
    resp = _call_with_reauth(
        lambda client: client.futures_chain(data={"symbol": fyers_symbol(ticker)})
    )
    if not isinstance(resp, dict) or resp.get("s") not in ("ok", "OK"):
        raise RuntimeError(f"futures_chain failed for {ticker}: {resp!r}"[:300])
    data = resp.get("data")
    return data if isinstance(data, list) else []


def compute_gex(chain: dict) -> dict:
    """Per-strike dealer gamma exposure from the options chain.

    No greeks come down the Fyers chain endpoint, so IV is backed out of
    each leg's LTP with Black-Scholes and gamma is analytic. Dealer
    convention (SpotGamma-style): dealers short calls / long puts, i.e.
    ``call_gex = -CE_OI * gamma`` and ``put_gex = +PE_OI * gamma``,
    scaled by ``spot / 1e7`` so values read as ₹Cr per 1-point move.
    Positive total = dealers long gamma (pin/chop); negative = short
    gamma (trend/amplification).
    """
    strikes = chain.get("strikes") or []
    spot = chain.get("spot")
    if spot is None or not strikes:
        return {"rows": [], "net_gex": None, "gamma_flip": None,
                "call_wall": None, "put_wall": None, "magnet": None}
    s = float(spot)
    t = max(_chain_dte_days(chain), 1) / 365.0
    rows: list[dict] = []
    last_iv = 0.25
    for row in strikes:
        k = _num(row.get("strike"))
        if k <= 0:
            continue
        ce_oi, pe_oi = _num(row.get("ce_oi")), _num(row.get("pe_oi"))
        ce_iv = _implied_vol(_num(row.get("ce_ltp")), s, k, t, "call") or last_iv
        pe_iv = _implied_vol(_num(row.get("pe_ltp")), s, k, t, "put") or last_iv
        last_iv = ce_iv
        scale = s / 1e7
        call_gex = -ce_oi * _bs_gamma(s, k, t, ce_iv) * scale
        put_gex = pe_oi * _bs_gamma(s, k, t, pe_iv) * scale
        rows.append({"strike": k, "call_gex": call_gex,
                     "put_gex": put_gex, "net": call_gex + put_gex})
    rows.sort(key=lambda r: r["strike"])

    net_gex = sum(r["net"] for r in rows) or None
    # Gamma flip: strike where per-strike net GEX changes sign (nearest
    # spot). Below the flip dealers are typically long gamma (puts
    # dominate), above it short (calls dominate) — the regime line.
    flip = None
    cands: list[float] = []
    for a, b in zip(rows, rows[1:]):
        if a["net"] != 0.0 and (a["net"] < 0) != (b["net"] < 0):
            cands.append(b["strike"] if abs(b["strike"] - s) < abs(a["strike"] - s) else a["strike"])
    if cands:
        flip = min(cands, key=lambda k: abs(k - s))
    # Walls reuse the OI definition: max CE OI above spot, max PE OI below.
    ce_by_k = {_num(x.get("strike")): _num(x.get("ce_oi")) for x in strikes}
    pe_by_k = {_num(x.get("strike")): _num(x.get("pe_oi")) for x in strikes}
    call_wall = max([k for k in ce_by_k if k > s], key=lambda k: ce_by_k[k], default=None)
    put_wall = max([k for k in pe_by_k if k < s], key=lambda k: pe_by_k[k], default=None)
    magnet = max(rows, key=lambda r: abs(r["net"]), default={}).get("strike")
    return {"rows": rows, "net_gex": net_gex, "gamma_flip": flip,
            "call_wall": call_wall, "put_wall": put_wall, "magnet": magnet}


def build_futures(ticker: str) -> dict:
    """Futures curve + gamma exposure bundle for one ticker. Cached 120s.

    Futures rows come from Fyers ``futures_chain`` (price, volume, expiry).
    That endpoint carries no OI fields, so ``oi``/``oich`` are null — the
    frontend labels them as unavailable rather than guessing. Gamma
    exposure is estimated from the options chain (see compute_gex).
    """
    t = (ticker or "").upper().strip()
    ck = f"futures:{t}"
    now = time.time()
    hit = _CACHE.get(ck)
    if hit and now - hit[0] < _SYMBOL_TTL:
        return hit[1]
    try:
        chain = get_chain(t)
        levels = compute_levels(chain)
        gex = compute_gex(chain)
        raw_futs = _get_futures_chain(t)
    except Exception:  # noqa: BLE001
        if hit:
            old = dict(hit[1])
            old["stale"] = True
            return old
        raise

    spot = chain.get("spot")
    today = datetime.now(IST).date()
    futures: list[dict] = []
    for f in raw_futs:
        if not isinstance(f, dict) or not f.get("expiry"):
            continue  # underlying row (no expiry) is spot, not a future
        try:
            exp = datetime.fromtimestamp(int(f["expiry"]), tz=IST).date().isoformat()
            dte = max(0, (datetime.fromtimestamp(int(f["expiry"]), tz=IST).date() - today).days)
        except (ValueError, TypeError, OSError):
            exp, dte = str(f.get("expiry")), None
        price = _num(f.get("lp"))
        basis = (price - spot) if (spot is not None and price) else None
        ann = (basis / spot * (365.0 / dte) * 100) if (basis is not None and spot and dte) else None
        futures.append({
            "expiry": exp,
            "symbol": f.get("symbol"),
            "price": price or None,
            "oi": None,  # Fyers futures_chain carries no OI fields
            "oich": None,
            "volume": _num(f.get("volume")) or None,
            "basis": basis,
            "annualized_basis": ann,
            "dte": dte,
        })
    futures.sort(key=lambda r: r.get("dte") if r.get("dte") is not None else 10**6)

    exp0 = (chain.get("expiries") or [""])[0]
    payload = {
        "ticker": t,
        "spot": spot,
        "as_of": chain.get("as_of"),
        "futures": futures,
        "max_pain": levels.get("max_pain"),
        "levels": {
            "call_wall": gex.get("call_wall"),
            "put_wall": gex.get("put_wall"),
            "gamma_flip": gex.get("gamma_flip"),
            "magnet": gex.get("magnet"),
        },
        "gex": gex.get("rows"),
        "net_gex": gex.get("net_gex"),
        "oi_by_expiry": [{
            "expiry": exp0,
            "call_oi": chain.get("call_oi"),
            "put_oi": chain.get("put_oi"),
        }],
    }
    _CACHE[ck] = (time.time(), payload)
    return payload


if __name__ == "__main__":
    import json

    arg = sys.argv[1] if len(sys.argv) > 1 else "__snapshot__"
    if arg == "__snapshot__":
        snap = build_snapshot()
        print(json.dumps(
            {"generated_at": snap["generated_at"],
             "indices": snap["sections"]["indices"],
             "leaders": list(snap["sections"]["leaders"])}, indent=2))
    elif arg.startswith("?"):
        print(json.dumps(search_symbols(arg[1:])))
    else:
        print(json.dumps(build_symbol(arg), indent=2)[:2000])

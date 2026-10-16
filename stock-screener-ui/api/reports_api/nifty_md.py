"""Pooled Nifty market-data WebSocket: one socket carrying the whole report feed.

Why this exists
---------------
The Nifty report is currently computed from REST polling (the 60s OI tape,
per-tick spot polls). REST is the latency floor and the rate-limit risk.
This module owns **one** ``MarketDataStreamerV3`` connection that carries
everything the report needs, so a future wiring task can compute the report
from live ticks instead of REST:

* the NIFTY index (``ltpc`` — LTP only; the index never carries OI/IV),
* ``NSE_INDEX|India VIX`` (``ltpc``),
* ``BSE_INDEX|SENSEX`` (``ltpc``, skipped when the key does not resolve),
* **every** CE/PE leg of the nearest-expiry chain (``option_greeks`` —
  LTP + OI + IV + delta/gamma). The full Nifty chain is ~200 keys against a
  ~3000-key ``option_greeks`` budget, so the whole chain is subscribed;
  only when the key count looks unreasonable (> 1500) does it fall back to
  ATM +/-10.

Connection budget (Upstox allows **2** WS connections per user)
---------------------------------------------------------------
This module opens **at most ONE** streamer, shared by all keys above (the
SDK's ``subscribe(keys, mode)`` carries per-key modes on the single
socket). It deliberately does NOT reuse ``api.orderflow_pool``: the pool's
slots are single-mode, while this feed needs mixed ``ltpc`` + ``option_greeks``
modes on one connection. Deployments already running the paper live stream
and/or orderflow must count this socket: live-stream (1) + this module (1)
= at the limit; do not add a fourth consumer without multiplexing.

Safety
------
* Market-hours gated (``trading.utils.is_market_open``; sleeps 60s when closed).
* Keys re-resolved every 15 min (handles the expiry roll); the session only
  restarts when the key set actually changed.
* Every step wrapped; the task never raises (``CancelledError`` re-raised).
* State is a module-level dict under a ``threading.Lock`` (ticks arrive on
  the SDK thread); ``snapshot()`` / ``is_live()`` never raise and the
  snapshot is always JSON-safe.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from datetime import datetime
from typing import Any, Optional

logger = logging.getLogger(__name__)

#: Freshness bar for :func:`is_live` (seconds since the last tick).
LIVE_TTL_SEC = 15.0
#: Re-resolve instrument keys this often (handles the expiry roll).
RESOLVE_EVERY_SEC = 900.0
#: Async-loop poll cadence while a session is up.
POLL_SEC = 5.0
#: Sleep while the market is closed.
CLOSED_SLEEP_SEC = 60.0
#: Sleep after a failed resolve / missing token before retrying.
RETRY_SLEEP_SEC = 30.0
#: Reconnect backoff base / cap.
RECONNECT_BASE_SEC = 5.0
RECONNECT_MAX_SEC = 120.0
#: Whole-chain subscribe cap; above this fall back to ATM +/-N.
MAX_CHAIN_KEYS = 1500
ATM_FALLBACK_N = 10
#: Restart a session that is connected but has produced no tick for this long.
STALE_RESTART_SEC = 120.0

#: Index / cross-index keys subscribed in ``ltpc`` mode.
VIX_KEY = "NSE_INDEX|India VIX"

_LEG_FIELDS = ("oi", "iv", "ltp", "volume", "delta", "gamma")


def _leg_key(strike: float, leg: str) -> str:
    return f"{float(strike)}:{leg}"


def _normalise_leg(leg: Any) -> Optional[str]:
    text = str(leg or "").strip().lower()
    if text in ("ce", "call"):
        return "ce"
    if text in ("pe", "put"):
        return "pe"
    return None


def _safe_float_or_none(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out


# ---------------------------------------------------------------------------
# Shared state (one writer per key conceptually; the SDK thread writes ticks)
# ---------------------------------------------------------------------------

_lock = threading.Lock()
_state: dict[str, Any] = {
    "ts": None,
    "connected": False,
    "spot": None,
    "vix": None,
    "sensex": None,
    "legs": {},
}
_last_tick_ts: Optional[float] = None
#: instrument_key -> (strike, leg); leg is "ce"/"pe" or "index"/"vix"/"sensex".
_key_map: dict[str, tuple[float, str]] = {}

_md_task: Optional[asyncio.Task] = None
_session: dict[str, Any] = {
    "sig": None,
    "stop": None,
    "err": None,
    "thread": None,
    "streamer": None,
}


def _touch(ts: Optional[float] = None) -> None:
    """Mark a fresh tick (updates ``ts`` + liveness clock). Never raises."""
    global _last_tick_ts
    try:
        now = float(ts) if ts is not None else time.time()
        _last_tick_ts = now
        with _lock:
            try:
                import config

                _state["ts"] = datetime.fromtimestamp(now, tz=config.IST).isoformat()
            except Exception:
                _state["ts"] = datetime.utcfromtimestamp(now).isoformat()
    except Exception:
        pass


def _set_connected(flag: bool) -> None:
    try:
        with _lock:
            _state["connected"] = bool(flag)
    except Exception:
        pass


def _set_spot(value: Any) -> None:
    try:
        spot = _safe_float_or_none(value)
        with _lock:
            _state["spot"] = spot
    except Exception:
        return
    _touch()


def _set_vix(value: Any) -> None:
    try:
        with _lock:
            _state["vix"] = _safe_float_or_none(value)
    except Exception:
        return
    _touch()


def _set_sensex(value: Any) -> None:
    try:
        with _lock:
            _state["sensex"] = _safe_float_or_none(value)
    except Exception:
        return
    _touch()


def _set_leg(strike: Any, leg: Any, **fields: Any) -> None:
    """Store one option leg's latest tick. Unknown legs are ignored."""
    norm = _normalise_leg(leg)
    try:
        strike_f = float(strike)
    except (TypeError, ValueError):
        return
    if norm is None:
        return
    try:
        key = _leg_key(strike_f, norm)
        with _lock:
            row = _state["legs"].get(key) or {}
            for name in _LEG_FIELDS:
                if name in fields:
                    row[name] = _safe_float_or_none(fields[name])
                else:
                    row.setdefault(name, None)
            _state["legs"][key] = row
    except Exception:
        return
    _touch()


def _reset_state_for_tests() -> None:
    """Reset shared state (tests only)."""
    global _last_tick_ts, _key_map
    with _lock:
        _state.update(
            {"ts": None, "connected": False, "spot": None,
             "vix": None, "sensex": None, "legs": {}}
        )
    _last_tick_ts = None
    _key_map = {}


def snapshot() -> dict:
    """Current feed state (never raises, always JSON-safe)."""
    try:
        with _lock:
            legs = {
                k: {f: (float(v) if isinstance(v, (int, float)) else None)
                    for f, v in (row or {}).items() if f in _LEG_FIELDS}
                for k, row in (_state.get("legs") or {}).items()
            }
            for row in legs.values():
                for f in _LEG_FIELDS:
                    row.setdefault(f, None)
            out = {
                "ts": _state.get("ts"),
                "connected": bool(_state.get("connected")),
                "spot": _state.get("spot"),
                "vix": _state.get("vix"),
                "sensex": _state.get("sensex"),
                "legs": legs,
            }
            for name in ("spot", "vix", "sensex"):
                val = out[name]
                out[name] = float(val) if isinstance(val, (int, float)) else None
            return out
    except Exception:
        return {"ts": None, "connected": False, "spot": None,
                "vix": None, "sensex": None, "legs": {}}


def is_live() -> bool:
    """True when the socket is up AND a tick arrived within ``LIVE_TTL_SEC``."""
    try:
        with _lock:
            connected = bool(_state.get("connected"))
        if not connected or _last_tick_ts is None:
            return False
        return (time.time() - float(_last_tick_ts)) <= float(LIVE_TTL_SEC)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Subscription resolution (pure part is unit-testable)
# ---------------------------------------------------------------------------

def build_subscription_keys(payload: dict) -> tuple[list[str], list[str], dict]:
    """Split one ``/option/chain`` payload into subscribe groups.

    Returns ``(ltpc_keys, greeks_keys, key_map)`` where ``key_map`` maps
    every instrument key to ``(strike, leg)`` (``"index"``/``"vix"``/
    ``"sensex"`` for the ``ltpc`` keys, ``"ce"``/``"pe"`` for options).
    Never raises — a bad payload yields empty groups.
    """
    ltpc_keys: list[str] = []
    greeks_keys: list[str] = []
    key_map: dict[str, tuple[float, str]] = {}
    try:
        from api.options import get_instrument_key

        items = (payload or {}).get("data", []) or []
        rows: list[tuple[float, str, str]] = []  # (strike, ce_key, pe_key)
        for item in items:
            if not isinstance(item, dict):
                continue
            try:
                strike = float(item.get("strike_price") or 0)
            except (TypeError, ValueError):
                continue
            if not strike:
                continue
            ce = (item.get("call_options") or {}).get("instrument_key") or ""
            pe = (item.get("put_options") or {}).get("instrument_key") or ""
            if not ce or not pe:
                continue
            rows.append((strike, ce, pe))

        if len(rows) * 2 > MAX_CHAIN_KEYS:
            # Unreasonable key count — fall back to ATM +/-N around the
            # chain's own spot instead of subscribing thousands of keys.
            try:
                from api.reports_api.nifty import parse_chain_payload

                _, spot, _ = parse_chain_payload(payload or {})
            except Exception:
                spot = 0.0
            try:
                from api.reports_api.nifty_oi_stream import select_atm_contracts

                contracts = [
                    {"strike_price": s,
                     "call_options": {"instrument_key": ce},
                     "put_options": {"instrument_key": pe}}
                    for s, ce, pe in rows
                ]
                kept = {r["strike"] for r in
                        select_atm_contracts(contracts, spot, ATM_FALLBACK_N)}
                rows = [r for r in rows if r[0] in kept]
            except Exception:
                pass

        try:
            index_key = get_instrument_key("NIFTY")
        except Exception:
            index_key = ""
        if index_key:
            ltpc_keys.append(index_key)
            key_map[index_key] = (0.0, "index")
        ltpc_keys.append(VIX_KEY)
        key_map[VIX_KEY] = (0.0, "vix")
        try:
            sensex_key = get_instrument_key("SENSEX")
        except Exception:
            sensex_key = ""
        if sensex_key:
            ltpc_keys.append(sensex_key)
            key_map[sensex_key] = (0.0, "sensex")

        for strike, ce, pe in rows:
            greeks_keys.append(ce)
            greeks_keys.append(pe)
            key_map[ce] = (strike, "ce")
            key_map[pe] = (strike, "pe")
    except Exception:
        pass
    return ltpc_keys, greeks_keys, key_map


async def _fetch_chain_payload() -> Optional[dict]:
    """Nearest-expiry ``/option/chain`` payload, or None. Never raises."""
    try:
        from api.options import fetch_upstox, get_instrument_key

        underlying = get_instrument_key("NIFTY")
        try:
            contracts = await fetch_upstox("/option/contract",
                                           {"instrument_key": underlying})
        except Exception as exc:
            logger.warning("nifty md: contract list failed: %s", exc)
            return None
        expiries = sorted({
            c.get("expiry") for c in (contracts.get("data") or [])
            if isinstance(c, dict) and c.get("expiry")
        })
        if not expiries:
            return None
        try:
            return await fetch_upstox("/option/chain", {
                "instrument_key": underlying,
                "expiry_date": expiries[0],
            })
        except Exception as exc:
            logger.warning("nifty md: chain fetch failed: %s", exc)
            return None
    except Exception as exc:
        logger.warning("nifty md: resolve failed: %s", exc)
        return None


def _install_mapping(mapping: dict) -> None:
    """Swap the key map and drop legs that are no longer subscribed."""
    global _key_map
    try:
        wanted = set()
        for _key, (strike, leg) in (mapping or {}).items():
            if leg in ("ce", "pe"):
                try:
                    wanted.add(_leg_key(float(strike), leg))
                except (TypeError, ValueError):
                    continue
        with _lock:
            for stale in [k for k in _state.get("legs", {}) if k not in wanted]:
                _state["legs"].pop(stale, None)
        _key_map = dict(mapping or {})
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Tick decoding (pure routing over the SDK's already-decoded dicts)
# ---------------------------------------------------------------------------

def _ltp_of(feed: dict) -> Optional[float]:
    try:
        ltpc = (feed or {}).get("ltpc") or {}
        return _safe_float_or_none(ltpc.get("ltp"))
    except Exception:
        return None


def _apply_feed(ikey: str, feed: dict) -> None:
    """Route one decoded feed into the shared state. Never raises."""
    try:
        if not isinstance(feed, dict):
            return
        entry = _key_map.get(ikey)
        if entry is None:
            return
        strike, leg = entry
        if leg == "index":
            _set_spot(_ltp_of(feed))
            return
        if leg == "vix":
            _set_vix(_ltp_of(feed))
            return
        if leg == "sensex":
            _set_sensex(_ltp_of(feed))
            return
        if leg not in ("ce", "pe"):
            return
        first = feed.get("firstLevelWithGreeks") or {}
        greeks = feed.get("optionGreeks") or feed.get("option_greeks") or {}
        oi = feed.get("oi")
        if oi is None and isinstance(first, dict):
            oi = first.get("oi")
        iv = feed.get("iv")
        if iv is None and isinstance(first, dict):
            iv = first.get("iv")
        if iv is None and isinstance(greeks, dict):
            iv = greeks.get("iv")
        delta = greeks.get("delta") if isinstance(greeks, dict) else None
        gamma = greeks.get("gamma") if isinstance(greeks, dict) else None
        volume = feed.get("volume")
        _set_leg(strike, leg, oi=oi, iv=iv, ltp=_ltp_of(feed),
                 volume=volume, delta=delta, gamma=gamma)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# WebSocket session (blocking SDK — runs in a daemon thread)
# ---------------------------------------------------------------------------

def _run_ws_session(ltpc_keys: list, greeks_keys: list,
                    stop: threading.Event, err: threading.Event) -> None:
    """Own the single Upstox socket for this session (worker thread)."""
    streamer = None
    try:
        import upstox_client
        from upstox_client import MarketDataStreamerV3

        from api.paper.live_stream import _get_upstox_token

        token = _get_upstox_token()
        if not token:
            logger.warning("nifty md: no Upstox token; session skipped")
            if not stop.is_set():
                err.set()
            return
        cfg = upstox_client.Configuration()
        cfg.access_token = token
        client = upstox_client.ApiClient(cfg)

        # ONE streamer for every key; per-key modes go on subscribe().
        streamer = MarketDataStreamerV3(client, [], mode="option_greeks")
        _session["streamer"] = streamer

        def on_open() -> None:
            try:
                # Subscribe inside the open handler — the SDK raises otherwise.
                if ltpc_keys:
                    streamer.subscribe(list(ltpc_keys), "ltpc")
                if greeks_keys:
                    streamer.subscribe(list(greeks_keys), "option_greeks")
                _set_connected(True)
            except Exception as exc:
                logger.warning("nifty md: subscribe failed: %s", exc)
                _set_connected(False)
                if not stop.is_set():
                    err.set()

        def on_message(data: Any) -> None:
            try:
                if stop.is_set():
                    return
                feeds = data.get("feeds", {}) if isinstance(data, dict) else {}
                for ikey, feed in feeds.items():
                    _apply_feed(ikey, feed)
            except Exception:
                pass

        def on_error(exc: Any) -> None:
            logger.warning("nifty md WS error: %s", exc)
            _set_connected(False)
            if not stop.is_set():
                err.set()

        streamer.on("message", on_message)
        streamer.on("error", on_error)
        streamer.on("open", on_open)
        streamer.connect()
    except Exception as exc:
        logger.warning("nifty md WS failed: %s", exc)
        if not stop.is_set():
            err.set()
    finally:
        _set_connected(False)
        try:
            if _session.get("streamer") is streamer:
                _session["streamer"] = None
        except Exception:
            pass
        if not stop.is_set():
            err.set()


def _stop_session() -> None:
    """Disconnect the current session best-effort (never raises)."""
    try:
        stop = _session.get("stop")
        if stop is not None:
            try:
                stop.set()
            except Exception:
                pass
        streamer = _session.get("streamer")
        if streamer is not None:
            try:
                streamer.disconnect()
            except Exception:
                pass
    except Exception:
        pass
    finally:
        try:
            _session.update({"sig": None, "stop": None, "err": None,
                             "thread": None, "streamer": None})
        except Exception:
            pass


def _market_open() -> bool:
    try:
        from trading.utils import is_market_open

        return bool(is_market_open())
    except Exception:
        return False


async def nifty_md_task() -> None:
    """Background loop: resolve keys, hold ONE WS session, re-resolve.

    Market-hours gated (sleeps 60s when closed). Keys re-resolved every
    15 min; the session restarts only when the key set changed, when the
    socket errored, or when ticks go stale. Never raises (``CancelledError``
    is re-raised so lifespan shutdown can cancel the task).
    """
    backoff = RECONNECT_BASE_SEC
    last_resolve = 0.0
    try:
        while True:
            try:
                if not _market_open():
                    await asyncio.sleep(CLOSED_SLEEP_SEC)
                    continue

                now = time.time()
                if (_session.get("sig") is None
                        or (now - last_resolve) >= RESOLVE_EVERY_SEC):
                    payload = await _fetch_chain_payload()
                    if not payload:
                        await asyncio.sleep(RETRY_SLEEP_SEC)
                        continue
                    ltpc_keys, greeks_keys, mapping = \
                        build_subscription_keys(payload)
                    if not greeks_keys:
                        await asyncio.sleep(RETRY_SLEEP_SEC)
                        continue
                    _install_mapping(mapping)
                    last_resolve = time.time()
                    sig = (tuple(sorted(ltpc_keys)),
                           tuple(sorted(greeks_keys)))
                    if sig != _session.get("sig"):
                        _stop_session()
                        stop = threading.Event()
                        err = threading.Event()
                        thread = threading.Thread(
                            target=_run_ws_session,
                            args=(ltpc_keys, greeks_keys, stop, err),
                            daemon=True,
                        )
                        _session.update({"sig": sig, "stop": stop,
                                         "err": err, "thread": thread})
                        thread.start()
                        logger.info("nifty md: session started (%d ltpc + %d greeks keys)",
                                    len(ltpc_keys), len(greeks_keys))
                    backoff = RECONNECT_BASE_SEC

                err = _session.get("err")
                thread = _session.get("thread")
                session_dead = (
                    (err is not None and err.is_set())
                    or (_session.get("sig") is not None
                        and thread is not None and not thread.is_alive())
                )
                if session_dead:
                    _stop_session()
                    logger.warning("nifty md: session died; reconnect in %.0fs",
                                   backoff)
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, RECONNECT_MAX_SEC)
                    continue
                if (_session.get("sig") is not None
                        and _last_tick_ts is not None
                        and (time.time() - _last_tick_ts) > STALE_RESTART_SEC):
                    logger.warning("nifty md: ticks stale; restarting session")
                    _stop_session()
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, RECONNECT_MAX_SEC)
                    continue
                await asyncio.sleep(POLL_SEC)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("nifty md loop error: %s", exc)
                try:
                    await asyncio.sleep(backoff)
                except asyncio.CancelledError:
                    raise
                backoff = min(backoff * 2, RECONNECT_MAX_SEC)
    finally:
        _stop_session()


def start_nifty_md_task() -> Optional[asyncio.Task]:
    """Start :func:`nifty_md_task` unless already running (idempotent).

    Never raises: without a running event loop there is nothing to attach
    the task to, so the current handle (None on first call) is returned.
    """
    global _md_task
    try:
        if _md_task is not None and not _md_task.done():
            return _md_task
    except Exception:
        pass
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return _md_task
    try:
        _md_task = loop.create_task(nifty_md_task())
    except Exception:
        pass
    return _md_task


def stop_nifty_md_task() -> None:
    """Cancel the background task + disconnect the session (best-effort)."""
    global _md_task
    try:
        task, _md_task = _md_task, None
        if task is not None and not task.done():
            try:
                task.cancel()
            except Exception:
                pass
    except Exception:
        pass
    try:
        _stop_session()
    except Exception:
        pass

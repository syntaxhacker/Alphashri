"""
Order Flow live bridge (WebSocket).

Speaks the OpenAlgo-style protocol that the vendored OrderFlowMap visualizer
expects, but streams data from Upstox MarketDataStreamerV3 in ``full`` mode
(5-level depth + cumulative traded volume).

Protocol
--------
Client -> ``{"action": "authenticate", "api_key": "<alphashri JWT>"}``
Server -> ``{"message": "Authentication successful"}``
Client -> ``{"action": "subscribe", "symbol": "RELIANCE", "exchange": "NSE",
            "mode": 3, "depth": 5}``
Server -> ``{"type": "subscribe", "status": "success"}``
Server -> ``{"type": "market_data", "data": {ltp, volume, ltt,
            depth: {buy: [{price, quantity, orders}], sell: [...]}}}``

Notes
-----
Upstox V3 does not expose per-level order counts, so ``orders`` is always 0.
Trade prints are reconstructed client-side from ``volume`` (``vtt``) deltas,
which is exactly how OrderFlowMap already works.
"""

import asyncio
import json
import os
import queue as thr_queue
import threading
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse

from api.auth import decode_token, get_current_user
from api.paper.live_stream import _get_upstox_token
from api import orderflow_journal
from api.orderflow_signals import OrderFlowSignalEngine

try:  # orjson serializes a 50-level tick ~9x faster than stdlib json
    import orjson as _fastjson

    def _dumps(payload) -> str:
        return _fastjson.dumps(payload, default=str).decode("utf-8")

except ImportError:  # pragma: no cover - fallback keeps the module importable
    def _dumps(payload) -> str:
        return json.dumps(payload, separators=(",", ":"), default=str)


#: Max queued messages folded into one WebSocket frame. A burst of depth
#: updates then costs one thread hop + one encode + one frame instead of one
#: per tick, which is what the event loop was spending its time on.
_PUMP_BATCH_MAX = 256

router = APIRouter(tags=["Order Flow"])

# Upstox full mode emits 5 depth levels per quote list.
_DEPTH_LEVELS = 5


def _num(value, default: float = 0.0) -> float:
    """Coerce protobuf JSON values (int64 arrives as string) to float."""
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


_INSTRUMENTS_JSON_CACHE: Optional[dict] = None


def _load_instruments_json() -> dict:
    """Lazily load the local NSE instruments JSON (includes NSE_FO contracts).

    Used as a fallback when a symbol is not in the DB — enables resolving
    option/futures trading symbols like ``NIFTY 23250 PE 22 SEP 26``.
    """
    global _INSTRUMENTS_JSON_CACHE
    if _INSTRUMENTS_JSON_CACHE is not None:
        return _INSTRUMENTS_JSON_CACHE

    mapping: dict = {}
    try:
        import config
        from pathlib import Path
        import json as _json

        path = (
            Path(config.BASE_DIR).parent
            / "upstox_trader"
            / "config_and_utils"
            / "nse_instruments.json"
        )
        if path.exists():
            with open(path) as f:
                for item in _json.load(f):
                    ts = item.get("trading_symbol")
                    key = item.get("instrument_key")
                    if ts and key:
                        mapping[ts.strip().upper()] = key
    except Exception:
        pass

    _INSTRUMENTS_JSON_CACHE = mapping
    return mapping


def _resolve_instrument_key(symbol: str, exchange: str = "NSE") -> Optional[str]:
    """Resolve a user symbol to an Upstox instrument key.

    Accepts an already-formatted key (``NSE_EQ|INE002A01018``) verbatim,
    otherwise looks it up in the local ``instruments`` table, then the local
    instruments JSON (which covers NSE_FO option/futures contracts).
    """
    raw = (symbol or "").strip()
    if not raw:
        return None
    # Already-formatted keys are case-sensitive (e.g. "NSE_INDEX|Nifty 50",
    # option contracts) — return them verbatim, never upper-cased.
    if "|" in raw:
        return raw

    symbol = raw.upper()
    exchange = (exchange or "NSE").strip().upper()

    try:
        from db.database import SessionLocal
        from db.models import Instrument

        db = SessionLocal()
        try:
            query = db.query(Instrument).filter(Instrument.trading_symbol == symbol)
            if exchange in ("NSE", "NFO", "BSE", "BFO", "MCX", "CDS"):
                pref = query.filter(Instrument.exchange == exchange).first()
                if pref:
                    return pref.instrument_key
            # Prefer cash equities when no exchange preference matches.
            row = (
                query.filter(Instrument.segment == "NSE_EQ").first()
                or query.filter(Instrument.segment == "BSE_EQ").first()
                or query.first()
            )
            if row:
                return row.instrument_key
        finally:
            db.close()
    except Exception:
        pass

    # Fallback: local instruments JSON (covers NSE_FO contracts, indices, etc.)
    return _load_instruments_json().get(symbol)


def _day_ohlc(mff: dict) -> Optional[dict]:
    """Extract the daily OHLC entry from the full feed's ``marketOHLC``."""
    for ohlc in (mff.get("marketOHLC") or {}).get("ohlc") or []:
        if not isinstance(ohlc, dict):
            continue
        if ohlc.get("interval") == "1d":
            return {
                "open": _num(ohlc.get("open")),
                "high": _num(ohlc.get("high")),
                "low": _num(ohlc.get("low")),
                "close": _num(ohlc.get("close")),
                "volume": _num(ohlc.get("vol")),
            }
    return None


def _normalize_tick(feed_map: dict) -> Optional[dict]:
    """Map an Upstox ``fullFeed.marketFF`` payload to the OrderFlowMap shape."""
    if not isinstance(feed_map, dict):
        return None

    for feed in feed_map.values():
        if not isinstance(feed, dict):
            continue
        full_feed = feed.get("fullFeed") or {}
        mff = full_feed.get("marketFF")
        if not mff:
            # Indices carry no order book (indexFF): emit price + OHLC only.
            index_ff = full_feed.get("indexFF")
            if not index_ff:
                continue
            ltpc = index_ff.get("ltpc") or {}
            ltp = ltpc.get("ltp")
            if ltp is None:
                continue
            return {
                "type": "market_data",
                "data": {
                    "ltp": _num(ltp),
                    "volume": 0.0,
                    "vwap": 0.0,
                    "ltt": int(_num(ltpc.get("ltt"))),
                    "ltq": _num(ltpc.get("ltq")),
                    "cp": _num(ltpc.get("cp")),
                    "tbq": 0.0,
                    "tsq": 0.0,
                    "oi": 0.0,
                    "iv": 0.0,
                    "greeks": None,
                    "day": _day_ohlc(index_ff),
                    "depth": {"buy": [], "sell": []},
                },
            }

        ltpc = mff.get("ltpc") or {}
        ltp = ltpc.get("ltp")
        if ltp is None:
            continue

        bids: list[dict] = []
        asks: list[dict] = []
        quotes = (mff.get("marketLevel") or {}).get("bidAskQuote") or []
        for level in quotes[:_DEPTH_LEVELS]:
            if not isinstance(level, dict):
                continue
            bp, bq = _num(level.get("bidP")), _num(level.get("bidQ"))
            ap, aq = _num(level.get("askP")), _num(level.get("askQ"))
            if bp > 0 and bq > 0:
                bids.append({"price": bp, "quantity": bq, "orders": 0})
            if ap > 0 and aq > 0:
                asks.append({"price": ap, "quantity": aq, "orders": 0})

        if not bids and not asks:
            continue

        return {
            "type": "market_data",
            "data": {
                "ltp": _num(ltp),
                "volume": _num(mff.get("vtt")),
                # Upstox `atp` = average traded price for the day → true session VWAP.
                "vwap": _num(mff.get("atp")),
                "ltt": int(_num(ltpc.get("ltt"))),
                # Extra full-feed fields (free — no extra API calls).
                "cp": _num(ltpc.get("cp")),          # previous close
                "ltq": _num(ltpc.get("ltq")),        # last traded quantity
                "tbq": _num(mff.get("tbq")),         # total buy quantity (all levels)
                "tsq": _num(mff.get("tsq")),         # total sell quantity (all levels)
                "oi": _num(mff.get("oi")),           # open interest (F&O)
                "iv": _num(mff.get("iv")),           # implied volatility (F&O)
                "greeks": _normalize_greeks(mff),    # F&O only (None for equity)
                "day": _day_ohlc(mff),
                "depth": {"buy": bids, "sell": asks},
            },
        }
    return None


def _normalize_greeks(mff: dict) -> Optional[dict]:
    """Extract option greeks when present (F&O instruments only)."""
    og = mff.get("optionGreeks")
    if not isinstance(og, dict) or not og:
        return None
    if not any(k in og for k in ("delta", "gamma", "theta", "vega")):
        return None
    return {name: _num(og.get(name)) for name in ("delta", "gamma", "theta", "vega", "rho")}


_HISTORY_WINDOW_SEC = 600
_HISTORY_MAX_TICKS = 3000
_HISTORY_MAX_SIGNALS = 20

# The headless recorder is the canonical capture. Bridge journaling is OFF by
# default and must be opted into (ORDERFLOW_BRIDGE_JOURNAL=1): with it on, every
# browser tab appends its own broker's ticks to the same per-symbol file, so a
# day recorded from one feed silently collects another feed's ticks.
_BRIDGE_JOURNAL = os.getenv("ORDERFLOW_BRIDGE_JOURNAL", "0").strip().lower() in (
    "1",
    "true",
    "yes",
    "on",
)


def _tick_ts(entry: dict) -> int:
    data = entry.get("data") or {}
    try:
        return int(data.get("ltt") or entry.get("ts") or 0)
    except (TypeError, ValueError):
        return 0


def _build_history(
    symbol: str,
    window_sec: int = _HISTORY_WINDOW_SEC,
    max_ticks: int = _HISTORY_MAX_TICKS,
    broker: Optional[str] = None,
) -> dict:
    """Bounded replay of today's journaled session for a symbol.

    Returns the most recent ``window_sec`` of ticks (capped at ``max_ticks``)
    plus the last few signals, so a reloaded client can rebuild the chart.
    """
    empty = {"ticks": [], "signals": []}
    if not symbol or not orderflow_journal.is_enabled():
        return empty

    entries = orderflow_journal.read(symbol, kind="tick", broker=broker)
    ticks: list[dict] = []
    if entries:
        latest = max(_tick_ts(e) for e in entries)
        cutoff = latest - window_sec * 1000
        ticks = [
            e["data"]
            for e in entries
            if isinstance(e.get("data"), dict) and _tick_ts(e) >= cutoff
        ]
        if len(ticks) > max_ticks:
            ticks = ticks[-max_ticks:]

    signals = [
        e["data"]
        for e in orderflow_journal.read(symbol, kind="signal", broker=broker)
        if isinstance(e.get("data"), dict)
    ][-_HISTORY_MAX_SIGNALS:]

    return {"ticks": ticks, "signals": signals}


# Upstox allows 2 WebSocket connections per user (5 with Upstox Plus). Cap how
# many this process opens so we surface a clear message instead of a raw 403.
_conn_lock = threading.Lock()
_active_connections = 0


def _max_connections() -> int:
    try:
        return max(1, int(os.getenv("ORDERFLOW_MAX_CONNECTIONS", "5")))
    except (TypeError, ValueError):
        return 5


def _acquire_connection() -> bool:
    global _active_connections
    with _conn_lock:
        if _active_connections >= _max_connections():
            return False
        _active_connections += 1
        return True


def _release_connection() -> None:
    global _active_connections
    with _conn_lock:
        if _active_connections > 0:
            _active_connections -= 1


def _normalize_market_status(feed_response: dict) -> Optional[dict]:
    """Extract the ``market_info`` segment-status message from the feed."""
    if feed_response.get("type") != "market_info":
        return None
    info = feed_response.get("marketInfo") or {}
    segments = info.get("segmentStatus")
    if not segments:
        return None
    return {
        "type": "market_status",
        "segments": segments,
        "ts": int(_num(feed_response.get("currentTs"))),
    }


class _UpstoxOrderFlowStream:
    """Owns a single Upstox full-mode streamer for one instrument key."""

    def __init__(self, token: str, instrument_key: str, q: thr_queue.Queue, symbol: str = ""):
        self.token = token
        self.instrument_key = instrument_key
        self.q = q
        self.symbol = (symbol or "").strip().upper()
        self._streamer = None
        self._closed = False
        self._engine = OrderFlowSignalEngine()

    def warm_start(self) -> None:
        """Replay today's journaled ticks into a fresh engine (session CVD)."""
        try:
            if not self.symbol or not orderflow_journal.is_enabled():
                return
            entries = orderflow_journal.read(self.symbol, kind="tick", broker="upstox")
            if not entries:
                return
            engine = OrderFlowSignalEngine()
            for entry in entries:
                data = entry.get("data")
                if isinstance(data, dict):
                    engine.update(data)
            self._engine = engine
        except Exception:  # noqa: BLE001 - warm start must never break the bridge
            return

    def start(self) -> None:
        import upstox_client
        from upstox_client import MarketDataStreamerV3

        cfg = upstox_client.Configuration()
        cfg.access_token = self.token
        client = upstox_client.ApiClient(cfg)

        streamer = MarketDataStreamerV3(client, [], mode="full")
        self._streamer = streamer

        def on_open():
            try:
                streamer.subscribe([self.instrument_key], "full")
            except Exception as exc:  # noqa: BLE001
                self._push({"type": "error", "message": f"subscribe failed: {exc}"})

        def on_message(data):
            self.handle_feed_message(data)

        def on_error(err):
            msg = str(err)
            if "403" in msg:
                msg = (
                    f"Upstox rejected the connection (403) — per-user connection "
                    f"limit reached (max {_max_connections()}). Close another Order "
                    f"Flow tab and reconnect, or upgrade your Upstox plan."
                )
            self._push({"type": "error", "message": msg})

        streamer.on("open", on_open)
        streamer.on("message", on_message)
        streamer.on("error", on_error)
        streamer.connect()

    def handle_feed_message(self, data) -> None:
        """Process one decoded feed message: status, tick, and signal."""
        if self._closed or not isinstance(data, dict):
            return

        status = _normalize_market_status(data)
        if status:
            self._push(status)
            return

        feeds = data.get("feeds")
        if not feeds:
            return
        tick = _normalize_tick(feeds)
        if not tick:
            return
        self._push(tick)
        if _BRIDGE_JOURNAL:
            orderflow_journal.append(self.symbol, "tick", tick["data"], broker="upstox")
        signal = self._engine.update(tick["data"])
        if signal:
            self._push(signal)
            if _BRIDGE_JOURNAL:
                orderflow_journal.append(self.symbol, "signal", signal, broker="upstox")

    def _push(self, payload: dict) -> None:
        try:
            self.q.put_nowait(payload)
        except thr_queue.Full:
            pass

    def stop(self) -> None:
        self._closed = True
        if self._streamer is not None:
            try:
                self._streamer.disconnect()
            except Exception:
                pass
            self._streamer = None


class _AdapterOrderFlowStream:
    """Bridge stream backed by a broker adapter (Fyers, Fyers TBT, ...).

    Mirrors :class:`_UpstoxOrderFlowStream` (journal, per-symbol signal engine,
    history warm-start) but delegates the feed to a registered adapter, so the
    UI can consume any broker — including the 50-level Fyers TBT book.
    """

    def __init__(self, broker: str, symbol: str, token: str, q: thr_queue.Queue):
        self.broker = (broker or "").strip().lower()
        self.symbol = (symbol or "").strip().upper()
        self.token = token
        self.q = q
        self._sub = None
        self._closed = False
        self._engine = OrderFlowSignalEngine()
        # First-tick / first-error signals for the subscribe guardrail: a feed
        # that can never deliver (e.g. an Upstox instrument key on a Fyers
        # socket) stays silent, so the bridge waits briefly for one of these
        # before reporting subscribe success.
        self.first_tick = threading.Event()
        self.first_error = threading.Event()
        self.first_error_message: Optional[str] = None

    def warm_start(self) -> None:
        try:
            if not self.symbol or not orderflow_journal.is_enabled():
                return
            entries = orderflow_journal.read(self.symbol, kind="tick", broker=self.broker)
            if not entries:
                return
            engine = OrderFlowSignalEngine()
            for entry in entries:
                data = entry.get("data")
                if isinstance(data, dict):
                    engine.update(data)
            self._engine = engine
        except Exception:  # noqa: BLE001
            return

    def start(self) -> None:
        # Subscriptions go through the process-wide hub so a broker keeps ONE
        # connection. The Fyers SDK shares socket state at module scope, so a
        # per-tab adapter silently mixed instruments (RAYMOND's book paired with
        # RELIANCE's price/volume); growing the shared connection avoids that.
        from api.orderflow_adapter_hub import get_hub

        try:
            self._sub = get_hub().subscribe(
                self.broker,
                self.token,
                self.symbol,
                on_tick=self._handle_tick,
                on_error=self._push_adapter_error,
            )
        except Exception as exc:  # noqa: BLE001 - surfaced to the UI
            self._push_adapter_error(exc)

    def _push_adapter_error(self, error) -> None:
        """Forward a sanitized adapter error, flagged as auth when relevant.

        The raw broker text carries the HTTP response (Set-Cookie, cf-ray), so
        it is reduced to one line first; auth failures become their own message
        type so the UI can offer a route back to the broker settings instead of
        printing a status code into a log panel.
        """
        from api.orderflow_adapters.base import is_auth_error, sanitize_adapter_error

        message = sanitize_adapter_error(self.broker, error)
        if self.first_error_message is None:
            self.first_error_message = message
        self.first_error.set()
        self._push(
            {
                "type": "auth_error" if is_auth_error(f"{error} {message}") else "error",
                "broker": self.broker,
                "message": message,
            }
        )

    def _handle_tick(self, symbol, tick) -> None:
        # The hub routes by symbol, so a tick here is always this stream's symbol.
        if self._closed or not isinstance(tick, dict):
            return
        self.first_tick.set()
        self._push({"type": "market_data", "data": tick})
        if _BRIDGE_JOURNAL:
            orderflow_journal.append(self.symbol, "tick", tick, broker=self.broker)
        signal = self._engine.update(tick)
        if signal:
            self._push(signal)
            if _BRIDGE_JOURNAL:
                orderflow_journal.append(self.symbol, "signal", signal, broker=self.broker)

    def _push(self, payload: dict) -> None:
        try:
            self.q.put_nowait(payload)
        except thr_queue.Full:
            pass

    def stop(self) -> None:
        self._closed = True
        sub, self._sub = self._sub, None
        if sub is not None:
            try:
                sub.release()
            except Exception:  # noqa: BLE001
                pass


def _bridge_broker() -> str:
    # Bridge can use a different broker than the headless recorder; the Fyers
    # SDK is not safe with two sockets in one process, so keep them separate.
    return (
        os.getenv("ORDERFLOW_BRIDGE_BROKER") or os.getenv("ORDERFLOW_BROKER") or "upstox"
    ).strip().lower()


def _adapter_caps(broker: str) -> tuple:
    """(depth_levels, has_order_counts) for a broker (5/False for Upstox)."""
    from api.orderflow_adapters import get_adapter

    cls = get_adapter(broker)
    if cls is None:
        return _DEPTH_LEVELS, False
    return int(getattr(cls, "depth_levels", _DEPTH_LEVELS)), bool(
        getattr(cls, "has_order_counts", False)
    )


def _subscribe_grace_sec() -> float:
    """How long the bridge waits for a first tick before trusting a feed."""
    try:
        return max(0.0, float(os.getenv("ORDERFLOW_SUBSCRIBE_GRACE_SEC", "5")))
    except (TypeError, ValueError):
        return 5.0


async def _wait_for_first_feed_event(stream: "_AdapterOrderFlowStream", timeout_sec: float) -> str:
    """Wait for the adapter stream's first tick or error.

    Returns ``"tick"``, ``"error"``, or ``"timeout"``. A silent feed (wrong
    symbol format for the broker) produces neither, so the caller must treat
    ``"timeout"`` as a dead feed rather than reporting success.
    """
    if timeout_sec <= 0:
        if stream.first_tick.is_set():
            return "tick"
        if stream.first_error.is_set():
            return "error"
        return "timeout"
    deadline = time.monotonic() + timeout_sec
    while True:
        if stream.first_tick.is_set():
            return "tick"
        if stream.first_error.is_set():
            return "error"
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return "timeout"
        await asyncio.sleep(min(remaining, 0.05))


@router.websocket("/ws/orderflow")
async def orderflow_ws(websocket: WebSocket):
    await websocket.accept()

    q: thr_queue.Queue = thr_queue.Queue(maxsize=20000)
    stream_ref: dict = {"stream": None}

    def stop_stream() -> None:
        current = stream_ref.get("stream")
        if current is not None:
            try:
                current.stop()
            except Exception:
                pass
            _release_connection()
        stream_ref["stream"] = None

    pump_task: Optional[asyncio.Task] = None

    try:
        raw = await websocket.receive_text()
        try:
            auth_msg = json.loads(raw)
        except json.JSONDecodeError:
            await websocket.send_json({"message": "Authentication failed: invalid JSON"})
            await websocket.close()
            return

        if auth_msg.get("action") != "authenticate":
            await websocket.send_json({"message": "Authentication failed: expected authenticate"})
            await websocket.close()
            return

        payload = decode_token(auth_msg.get("api_key") or "")
        if not payload or payload.get("type") != "access":
            await websocket.send_json({"message": "Authentication failed: invalid or expired token"})
            await websocket.close()
            return

        await websocket.send_json({"message": "Authentication successful"})

        async def pump() -> None:
            try:
                while True:
                    item = await asyncio.to_thread(q.get)
                    if item is None:
                        return
                    batch = [item]
                    # Drain what is already queued so a burst is amortised.
                    while len(batch) < _PUMP_BATCH_MAX:
                        try:
                            nxt = q.get_nowait()
                        except thr_queue.Empty:
                            break
                        if nxt is None:
                            break
                        batch.append(nxt)
                    if len(batch) == 1:
                        await websocket.send_text(_dumps(batch[0]))
                    else:
                        await websocket.send_text(_dumps(batch))
            except Exception:  # noqa: BLE001 - socket closed mid-send
                return

        pump_task = asyncio.create_task(pump())

        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            action = msg.get("action")
            if action == "subscribe":
                symbol = msg.get("symbol") or ""
                exchange = msg.get("exchange") or "NSE"

                stop_stream()

                # Per-tab broker override (UI switch); falls back to env default.
                requested = (msg.get("broker") or "").strip().lower()
                broker = requested or _bridge_broker()
                if broker != "upstox":
                    from api.orderflow_recorder import recorder_token

                    token = await asyncio.to_thread(recorder_token, broker)
                    if not token:
                        await websocket.send_json(
                            {
                                "type": "subscribe",
                                "status": "error",
                                "message": f"No {broker} access token. Connect broker via Settings.",
                            }
                        )
                        continue
                    if not _acquire_connection():
                        await websocket.send_json(
                            {
                                "type": "subscribe",
                                "status": "error",
                                "message": "Connection limit reached. Close another Order Flow tab.",
                            }
                        )
                        continue
                    stream = _AdapterOrderFlowStream(broker, symbol, token, q)
                    stream_ref["stream"] = stream
                    try:
                        await asyncio.to_thread(stream.warm_start)
                    except Exception:  # noqa: BLE001
                        pass
                    try:
                        history = await asyncio.to_thread(_build_history, symbol, broker=broker)
                        if history["ticks"] or history["signals"]:
                            stream._push({"type": "history", "symbol": symbol, **history})
                    except Exception:  # noqa: BLE001
                        pass
                    try:
                        await asyncio.to_thread(stream.start)
                    except Exception as exc:  # noqa: BLE001
                        stop_stream()
                        await websocket.send_json(
                            {"type": "subscribe", "status": "error", "message": f"{broker} connect failed: {exc}"}
                        )
                        continue
                    levels, order_counts = _adapter_caps(broker)
                    verdict = await _wait_for_first_feed_event(stream, _subscribe_grace_sec())
                    if verdict == "tick":
                        await websocket.send_json(
                            {
                                "type": "subscribe",
                                "status": "success",
                                "broker": broker,
                                "depth_levels": levels,
                                "order_counts": order_counts,
                            }
                        )
                        continue
                    if verdict == "error":
                        detail = stream.first_error_message or "broker reported an error"
                        stop_stream()
                        await websocket.send_json(
                            {
                                "type": "subscribe",
                                "status": "error",
                                "message": f"{broker} error: {detail}",
                            }
                        )
                        continue
                    stop_stream()
                    await websocket.send_json(
                        {
                            "type": "subscribe",
                            "status": "error",
                            "message": (
                                f"{broker} feed produced no data for '{symbol}' within "
                                f"{_subscribe_grace_sec():g}s — the symbol may not resolve "
                                "on this broker. For option contracts, re-pick the contract "
                                "with this broker selected so the tab resolves the broker's "
                                "own symbol."
                            ),
                        }
                    )
                    continue

                instrument_key = await asyncio.to_thread(_resolve_instrument_key, symbol, exchange)
                if not instrument_key:
                    await websocket.send_json(
                        {"type": "subscribe", "status": "error", "message": f"Symbol not found: {symbol}"}
                    )
                    continue

                token = await asyncio.to_thread(_get_upstox_token)
                if not token:
                    await websocket.send_json(
                        {
                            "type": "subscribe",
                            "status": "error",
                            "message": "No Upstox access token. Connect broker via Settings.",
                        }
                    )
                    continue

                if not _acquire_connection():
                    await websocket.send_json(
                        {
                            "type": "subscribe",
                            "status": "error",
                            "message": (
                                f"Upstox connection limit reached (max {_max_connections()} per "
                                f"user). Close another Order Flow tab or upgrade your plan."
                            ),
                        }
                    )
                    continue

                stream = _UpstoxOrderFlowStream(token, instrument_key, q, symbol=symbol)
                stream_ref["stream"] = stream
                try:
                    await asyncio.to_thread(stream.warm_start)
                except Exception:  # noqa: BLE001 - warm start is best-effort
                    pass
                try:
                    history = await asyncio.to_thread(_build_history, symbol, broker=broker)
                    if history["ticks"] or history["signals"]:
                        stream._push({"type": "history", "symbol": symbol, **history})
                except Exception:  # noqa: BLE001 - history is best-effort
                    pass
                try:
                    await asyncio.to_thread(stream.start)
                except Exception as exc:  # noqa: BLE001
                    stop_stream()
                    await websocket.send_json(
                        {"type": "subscribe", "status": "error", "message": f"Upstox connect failed: {exc}"}
                    )
                    continue

                await websocket.send_json(
                    {
                        "type": "subscribe",
                        "status": "success",
                        "broker": "upstox",
                        "depth_levels": _DEPTH_LEVELS,
                        "order_counts": False,
                    }
                )

            elif action == "unsubscribe":
                stop_stream()
                await websocket.send_json({"type": "subscribe", "status": "success"})

    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        pass
    finally:
        stop_stream()
        try:
            q.put_nowait(None)
        except thr_queue.Full:
            pass
        if pump_task is not None:
            pump_task.cancel()


# --------------------------------------------------------------------------- #
# Journal browsing / replay (read-only)
#
# The recorded journal is shared market data, so these are authenticated but not
# admin-gated: the Order Flow tab is available to any signed-in user while the
# admin panel is not. Nothing here writes, and none of it touches the live
# bridge or the recorder.
# --------------------------------------------------------------------------- #

@router.get("/api/orderflow/journal/files")
async def list_journal_files_route(days: int = 30, _user=Depends(get_current_user)):
    """Stored journal files, newest first — powers the replay picker."""
    try:
        files = await asyncio.to_thread(orderflow_journal.list_journal_files, days)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"journal listing failed: {exc}")
    return {"files": files, "count": len(files)}


def _parse_hhmm(value: Optional[str]) -> Optional[int]:
    if not value:
        return None
    try:
        hour, minute = value.split(":")
        return int(hour) * 60 + int(minute)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail=f"bad time '{value}', expected HH:MM")


@router.get("/api/orderflow/journal/session")
async def get_journal_session(
    symbol: str,
    day: Optional[str] = None,
    broker: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    _user=Depends(get_current_user),
):
    """Stream one day's stored records as NDJSON.

    A whole session is ~180 MB, so a single JSON body would mean buffering it
    twice in the browser. Streaming one record per line keeps memory flat on
    both sides and lets the client feed its pipeline as it arrives.

    Line 1 is a ``meta`` object; every later line is the stored record shape
    (``{"ts", "kind", "data"}``) — identical to the bridge's history replay, so
    consumers need no new parsing logic.
    """
    if not symbol:
        raise HTTPException(status_code=400, detail="symbol is required")
    start_minute = _parse_hhmm(start)
    end_minute = _parse_hhmm(end)
    resolved_day = day or orderflow_journal._today()
    resolved_broker = (broker or "").strip().lower() or None

    meta = {
        "type": "meta",
        "symbol": symbol.strip().upper(),
        "day": resolved_day,
        "broker": resolved_broker,
        "start": start,
        "end": end,
        "enabled": orderflow_journal.is_enabled(),
    }

    def generate():
        yield json.dumps(meta) + "\n"
        for line in orderflow_journal.iter_session(
            symbol,
            day=resolved_day,
            broker=resolved_broker,
            start_minute=start_minute,
            end_minute=end_minute,
        ):
            yield line + "\n"

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )

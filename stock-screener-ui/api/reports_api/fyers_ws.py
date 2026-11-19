"""Live Fyers ticks for chart underlyings, over the shared adapter hub.

Endpoint (exact path, no prefix):
  ``/ws/fyers/ticks?symbol=NIFTY[&token=<alphashri JWT>]``

``symbol`` is one of the explicit underlyings in :data:`_UNDERLYINGS` (or an
already-qualified Fyers symbol). Every client subscribes through
``get_hub()``, so all tabs — and the order-flow bridge — share **one** Fyers
socket; a second subscriber only adds a listener, never a second connection.

Frames (all JSON objects):
  ``{"type":"status","state":"connecting|connected|market_closed|market_open|reconnecting|disconnected|error","reason":...,"broker":"fyers","symbol":...,"requested_symbol":...,"market_open":bool,"ts":...,"detail"?:...}``
  ``{"type":"tick","symbol":...,"requested_symbol":...,"data":{ltp,...},"ts":...}``

``state=disconnected`` with ``reason=no_token`` / ``expired_token`` means the
broker is not connected (and the socket is closed after the frame);
``state=market_closed`` means the broker is fine but the market is shut. An
upstream drop emits ``reconnecting``, then ``connected`` once resubscribed.

The hub is thread-based, so its callbacks only ever enqueue onto a bounded
``threading.Queue``; a pump coroutine moves them onto the event loop with
``to_thread`` (the ``api/paper/live_stream.py`` pattern). No data poll is added.

Auth mirrors ``/ws/nifty/report``: absent token is allowed, an invalid token
closes the socket with 1008. WebSocket routes do not appear in OpenAPI.
"""

from __future__ import annotations

import asyncio
import logging
import queue as thr_queue
import threading
import time
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import config
from api.orderflow_adapter_hub import get_hub
from api.orderflow_symbols import from_broker_symbol

logger = logging.getLogger(__name__)

router = APIRouter()

BROKER = "fyers"
DEFAULT_SYMBOL = "NIFTY"

#: requested symbol -> (app symbol the hub routes ticks to, Fyers wire symbol).
#: Fyers needs the qualified index symbol; a bare name would be qualified as
#: ``-EQ`` and silently stream nothing. This is the explicit, small set the
#: chart underlyings use.
_UNDERLYINGS: dict[str, tuple[str, str]] = {
    "NIFTY": ("NIFTY50-INDEX", "NSE:NIFTY50-INDEX"),
    "NIFTY50": ("NIFTY50-INDEX", "NSE:NIFTY50-INDEX"),
    "NIFTY50-INDEX": ("NIFTY50-INDEX", "NSE:NIFTY50-INDEX"),
    "BANKNIFTY": ("BANKNIFTY-INDEX", "NSE:BANKNIFTY-INDEX"),
    "BANKNIFTY-INDEX": ("BANKNIFTY-INDEX", "NSE:BANKNIFTY-INDEX"),
    "SENSEX": ("SENSEX-INDEX", "BSE:SENSEX-INDEX"),
    "SENSEX-INDEX": ("SENSEX-INDEX", "BSE:SENSEX-INDEX"),
}

_QUEUE_MAX = 2000
_BACKOFF_BASE = 1.0
_BACKOFF_CAP = 30.0
_RECONNECT_MAX = 5
_MARKET_CHECK_SEC = 60.0

_sessions_lock = threading.Lock()
_sessions: set["_ClientSession"] = set()


def _now_iso() -> str:
    return datetime.now(config.IST).isoformat()


def _market_open() -> bool:
    """Holiday-aware NSE session check (never raises)."""
    try:
        from trading.utils import is_market_open

        return bool(is_market_open())
    except Exception:
        return True


def _resolve_symbol(requested: str) -> Optional[tuple[str, str]]:
    """Map a requested symbol to (hub app symbol, Fyers wire symbol)."""
    key = (requested or "").strip().upper()
    if key in _UNDERLYINGS:
        return _UNDERLYINGS[key]
    if ":" in key:
        return from_broker_symbol(BROKER, key), key
    return None


def _resolve_token() -> tuple[Optional[str], Optional[str]]:
    """Return (wire token, None) or (None, reason). Never logs the token."""
    from api.brokers import _get_fyers_status
    from db.models import get_shared_broker_token

    try:
        status = _get_fyers_status()
    except Exception:
        status = {"connected": True}
    if not status.get("connected"):
        reason = "expired_token" if status.get("expires_in_hours") == 0 else "no_token"
        return None, reason
    try:
        data = get_shared_broker_token("fyers") or {}
    except Exception:
        return None, "no_token"
    access = data.get("access_token")
    if not access:
        return None, "no_token"
    token = f"{config.FYERS_CLIENT_ID}:{access}" if config.FYERS_CLIENT_ID else access
    return token, None


async def _reject_bad_token(websocket: WebSocket, token: Optional[str]) -> bool:
    """Close with 1008 and return True when an invalid token was supplied."""
    if not token:
        return False
    try:
        from api.auth import decode_token

        payload = decode_token(token)
    except Exception:
        payload = None
    if not payload:
        try:
            await websocket.close(code=1008)
        except Exception:
            pass
        return True
    return False


def _register(session: "_ClientSession") -> None:
    with _sessions_lock:
        _sessions.add(session)


def _unregister(session: "_ClientSession") -> None:
    with _sessions_lock:
        _sessions.discard(session)


def shutdown() -> None:
    """Release every live subscription (API shutdown / tests).

    A ``Subscription`` is idempotent, so a session's own ``finally`` releasing
    at the same time is harmless. Call from a thread when on an event loop.
    """
    with _sessions_lock:
        sessions = list(_sessions)
    for session in sessions:
        session.closed.set()
        try:
            session.q.put_nowait(None)
        except thr_queue.Full:
            pass
        session.release()


class _ClientSession:
    """One browser client's bridge onto the shared hub connection."""

    def __init__(
        self,
        websocket: WebSocket,
        requested: str,
        app_symbol: str,
        wire_symbol: str,
        hub,
        token: str,
    ):
        self.ws = websocket
        self.requested = requested
        self.app_symbol = app_symbol
        self.wire_symbol = wire_symbol
        self.hub = hub
        self.token = token
        self.q: thr_queue.Queue = thr_queue.Queue(maxsize=_QUEUE_MAX)
        self.closed = asyncio.Event()
        self.errors = asyncio.Event()
        self.sub = None
        self.state = "connecting"
        self.reason = "subscribed"
        self.market_open = _market_open()
        self.tasks: list[asyncio.Task] = []

    # -- hub callbacks (socket thread: never touch the event loop here) -----
    def on_tick(self, symbol: str, tick: dict) -> None:
        if self.closed.is_set():
            return
        try:
            self.q.put_nowait(("tick", symbol, tick, time.time()))
        except thr_queue.Full:
            pass

    def on_error(self, error: object) -> None:
        if self.closed.is_set():
            return
        from api.orderflow_adapters.base import sanitize_adapter_error

        try:
            self.q.put_nowait(("error", sanitize_adapter_error(BROKER, error), time.time()))
        except thr_queue.Full:
            pass

    # -- subscription lifecycle (blocking: call via to_thread) --------------
    def subscribe(self) -> None:
        self.sub = self.hub.subscribe_as(
            BROKER,
            self.token,
            self.app_symbol,
            self.wire_symbol,
            on_tick=self.on_tick,
            on_error=self.on_error,
        )

    def release(self) -> None:
        sub, self.sub = self.sub, None
        if sub is not None:
            try:
                sub.release()
            except Exception as exc:  # noqa: BLE001 - teardown is best effort
                logger.debug("fyers ws release failed: %s", exc)

    # -- frames -------------------------------------------------------------
    async def send_status(self, state: str, reason: str, detail: str | None = None) -> None:
        self.state, self.reason = state, reason
        frame = {
            "type": "status",
            "state": state,
            "reason": reason,
            "broker": BROKER,
            "symbol": self.app_symbol,
            "requested_symbol": self.requested,
            "market_open": self.market_open,
            "ts": _now_iso(),
        }
        if detail:
            frame["detail"] = detail[:300]
        try:
            await self.ws.send_json(frame)
        except (WebSocketDisconnect, RuntimeError, OSError):
            pass

    async def _close_ws(self) -> None:
        self.closed.set()
        try:
            self.q.put_nowait(None)
        except thr_queue.Full:
            pass
        try:
            await self.ws.close(code=1000)
        except Exception:
            pass

    # -- event-loop tasks ---------------------------------------------------
    async def pump(self) -> None:
        loop = asyncio.get_running_loop()
        while True:
            item = await loop.run_in_executor(None, self.q.get)
            if item is None:
                return
            kind = item[0]
            if kind == "tick":
                _, symbol, tick, _ts = item
                if self.state != "connected":
                    await self.send_status("connected", "ticks_flowing")
                try:
                    await self.ws.send_json(
                        {
                            "type": "tick",
                            "symbol": symbol,
                            "requested_symbol": self.requested,
                            "data": tick,
                            "ts": _now_iso(),
                        }
                    )
                except (WebSocketDisconnect, RuntimeError, OSError):
                    return
            elif kind == "error":
                _, detail, _ts = item
                await self.send_status("reconnecting", "upstream_error", detail)
                self.errors.set()

    async def receiver(self) -> None:
        """Notice a client disconnect even when the feed is silent."""
        try:
            while True:
                await self.ws.receive_text()
        except WebSocketDisconnect:
            pass
        except Exception:  # noqa: BLE001 - closed socket / cancelled task
            pass
        await self._close_ws()

    async def supervisor(self) -> None:
        attempt = 0
        while True:
            await self.errors.wait()
            if self.closed.is_set():
                return
            self.errors.clear()
            attempt += 1
            delay = min(_BACKOFF_CAP, _BACKOFF_BASE * (2 ** (attempt - 1)))
            try:
                await asyncio.wait_for(self.closed.wait(), timeout=delay)
                return
            except asyncio.TimeoutError:
                pass

            token, reason = _resolve_token()
            if not token:
                await self.send_status("disconnected", reason or "no_token")
                await self._close_ws()
                return

            await asyncio.to_thread(self.release)
            self.token = token
            try:
                await asyncio.to_thread(self.subscribe)
            except Exception as exc:  # noqa: BLE001
                from api.orderflow_adapters.base import sanitize_adapter_error

                await self.send_status(
                    "reconnecting", "resubscribe_failed", sanitize_adapter_error(BROKER, exc)
                )
                if attempt >= _RECONNECT_MAX:
                    await self.send_status("disconnected", "reconnect_exhausted")
                    await self._close_ws()
                    return
                self.errors.set()
                continue
            await self.send_status("connected", "resubscribed")
            attempt = 0

    async def watchdog(self) -> None:
        while True:
            try:
                await asyncio.wait_for(self.closed.wait(), timeout=_MARKET_CHECK_SEC)
                return
            except asyncio.TimeoutError:
                pass
            current = _market_open()
            if current != self.market_open:
                self.market_open = current
                state = "market_open" if current else "market_closed"
                await self.send_status(state, state)

    async def run(self) -> None:
        _register(self)
        self.tasks = [
            asyncio.create_task(self.pump(), name="fyers-ws-pump"),
            asyncio.create_task(self.receiver(), name="fyers-ws-receiver"),
            asyncio.create_task(self.supervisor(), name="fyers-ws-reconnect"),
            asyncio.create_task(self.watchdog(), name="fyers-ws-market"),
        ]
        try:
            if not self.market_open:
                await self.send_status("market_closed", "market_closed")
            else:
                await self.send_status("connecting", "subscribed")
            try:
                await asyncio.to_thread(self.subscribe)
            except Exception as exc:  # noqa: BLE001
                from api.orderflow_adapters.base import sanitize_adapter_error

                await self.send_status(
                    "disconnected", "connect_failed", sanitize_adapter_error(BROKER, exc)
                )
                await self._close_ws()
                return
            try:
                await asyncio.wait(self.tasks, return_when=asyncio.FIRST_COMPLETED)
            except WebSocketDisconnect:
                return
            except Exception as exc:  # noqa: BLE001
                logger.debug("fyers ws session error: %s", exc)
        finally:
            self.closed.set()
            try:
                self.q.put_nowait(None)
            except thr_queue.Full:
                pass
            for task in self.tasks:
                task.cancel()
            await asyncio.gather(*self.tasks, return_exceptions=True)
            await asyncio.to_thread(self.release)
            _unregister(self)


@router.websocket("/ws/fyers/ticks")
async def ws_fyers_ticks(
    websocket: WebSocket,
    symbol: str = DEFAULT_SYMBOL,
    token: Optional[str] = None,
):
    """Stream normalized Fyers ticks for one chart underlying over the hub."""
    await websocket.accept()
    try:
        if await _reject_bad_token(websocket, token):
            return
        target = _resolve_symbol(symbol)
        if target is None:
            await websocket.send_json(
                {
                    "type": "status",
                    "state": "error",
                    "reason": "unsupported_symbol",
                    "broker": BROKER,
                    "requested_symbol": symbol,
                    "market_open": _market_open(),
                    "ts": _now_iso(),
                }
            )
            await websocket.close(code=1000)
            return
        app_symbol, wire_symbol = target
        access, reason = _resolve_token()
        if not access:
            await websocket.send_json(
                {
                    "type": "status",
                    "state": "disconnected",
                    "reason": reason or "no_token",
                    "broker": BROKER,
                    "symbol": app_symbol,
                    "requested_symbol": symbol.strip().upper(),
                    "market_open": _market_open(),
                    "ts": _now_iso(),
                    "message": "Fyers is not connected. Connect it in Settings -> Brokers.",
                }
            )
            await websocket.close(code=1000)
            return
        session = _ClientSession(
            websocket, symbol.strip().upper(), app_symbol, wire_symbol, get_hub(), access
        )
        await session.run()
    except WebSocketDisconnect:
        return
    except Exception as exc:  # noqa: BLE001
        logger.debug("fyers ws fatal: %s", exc)

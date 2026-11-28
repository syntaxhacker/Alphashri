"""Live Fyers tick WebSocket tests.

The endpoint must stream ticks through the process-wide adapter hub (one socket
shared by every subscriber), bridge the hub's thread callbacks onto the event
loop, and report broker/market state honestly instead of staying silent.

All broker I/O and token lookups are faked: these tests never open a real
Fyers socket and never touch the production SQLite DB.
"""

from __future__ import annotations

import asyncio
import time

import pytest
from fastapi import WebSocketDisconnect
from fastapi.testclient import TestClient

from api.reports_api import fyers_ws
from tests.helpers.broker_hub import FakeAdapter as _FakeAdapter


class FakeAdapter(_FakeAdapter):
    """Hub double identified as the Fyers adapter."""

    name = "fyers"


class FakeWebSocket:
    """Minimal WebSocket double: records frames, blocks on receive."""

    def __init__(self):
        self.sent: list[dict] = []
        self.closed = None
        self.accepted = False
        self._disconnected = asyncio.Event()

    async def accept(self):
        self.accepted = True

    async def send_json(self, data):
        self.sent.append(data)

    async def close(self, code=1000):
        self.closed = code

    def drop(self):
        self._disconnected.set()

    async def receive_text(self):
        await self._disconnected.wait()
        raise WebSocketDisconnect()


def _hub_harness(monkeypatch):
    from api.broker_hub.hub import AdapterHub

    adapters: dict[str, FakeAdapter] = {}
    calls = {"factory": 0}

    def factory(broker, token):
        calls["factory"] += 1
        adapter = FakeAdapter()
        adapters[broker] = adapter
        return adapter

    hub = AdapterHub(adapter_factory=factory)
    monkeypatch.setattr(fyers_ws, "get_hub", lambda: hub)
    return hub, adapters, calls


def _patch_token(monkeypatch, token="APP:tok"):
    monkeypatch.setattr(fyers_ws, "_resolve_token", lambda: (token, None))


async def _wait_for(predicate, timeout=2.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("condition not met within %.1fs" % timeout)


async def _stop(*tasks):
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


def _frames(ws, kind):
    return [f for f in ws.sent if f.get("type") == kind]


def _has_state(ws, state):
    return any(f.get("state") == state for f in _frames(ws, "status"))



async def test_two_subscribers_share_one_hub_connection(monkeypatch):
    hub, adapters, calls = _hub_harness(monkeypatch)
    _patch_token(monkeypatch)
    monkeypatch.setattr(fyers_ws, "_market_open", lambda: True)

    ws1, ws2 = FakeWebSocket(), FakeWebSocket()
    t1 = asyncio.create_task(fyers_ws.ws_fyers_ticks(ws1, symbol="NIFTY"))
    t2 = asyncio.create_task(fyers_ws.ws_fyers_ticks(ws2, symbol="NIFTY"))
    await _wait_for(lambda: hub.subscriber_count("fyers") == 2)

    assert calls["factory"] == 1, "two WS clients must not open two Fyers sockets"
    assert adapters["fyers"].connected_symbols == ["NSE:NIFTY50-INDEX"]
    assert adapters["fyers"].added == [], "second client must not grow the socket"

    adapters["fyers"].emit("NSE:NIFTY50-INDEX", {"ltp": 25000.0})
    await _wait_for(lambda: _frames(ws1, "tick") and _frames(ws2, "tick"))
    await _stop(t1, t2)



async def test_disconnect_releases_subscription_and_last_release_closes(monkeypatch):
    hub, adapters, calls = _hub_harness(monkeypatch)
    _patch_token(monkeypatch)

    t1 = asyncio.create_task(fyers_ws.ws_fyers_ticks(FakeWebSocket(), symbol="NIFTY"))
    t2 = asyncio.create_task(fyers_ws.ws_fyers_ticks(FakeWebSocket(), symbol="NIFTY"))
    await _wait_for(lambda: hub.subscriber_count("fyers") == 2)

    t1.cancel()
    await asyncio.gather(t1, return_exceptions=True)
    await _wait_for(lambda: hub.subscriber_count("fyers") == 1)
    assert adapters["fyers"].disconnected == 0, "other client still needs the socket"

    t2.cancel()
    await asyncio.gather(t2, return_exceptions=True)
    await _wait_for(lambda: hub.subscriber_count("fyers") == 0)
    assert adapters["fyers"].disconnected == 1
    assert hub.active_brokers() == []



async def test_hub_tick_reaches_websocket_client(monkeypatch):
    hub, adapters, calls = _hub_harness(monkeypatch)
    _patch_token(monkeypatch)
    ws = FakeWebSocket()

    task = asyncio.create_task(fyers_ws.ws_fyers_ticks(ws, symbol="NIFTY"))
    await _wait_for(lambda: hub.subscriber_count("fyers") == 1)

    adapters["fyers"].emit("NSE:NIFTY50-INDEX", {"ltp": 25123.5, "volume": 42})

    await _wait_for(lambda: len(_frames(ws, "tick")) >= 1)
    tick = _frames(ws, "tick")[0]
    assert tick["symbol"] == "NIFTY50-INDEX"
    assert tick["requested_symbol"] == "NIFTY"
    assert tick["data"]["ltp"] == 25123.5
    assert _has_state(ws, "connected")
    await _stop(task)



async def test_no_token_sends_structured_disconnected_status(monkeypatch):
    hub, adapters, calls = _hub_harness(monkeypatch)
    monkeypatch.setattr(fyers_ws, "_resolve_token", lambda: (None, "no_token"))
    ws = FakeWebSocket()

    await asyncio.wait_for(fyers_ws.ws_fyers_ticks(ws, symbol="NIFTY"), timeout=1.0)

    statuses = _frames(ws, "status")
    assert statuses and statuses[0]["state"] == "disconnected"
    assert statuses[0]["reason"] == "no_token"
    assert statuses[0]["broker"] == "fyers"
    assert statuses[0]["market_open"] is True or statuses[0]["market_open"] is False
    assert calls["factory"] == 0, "no token must not open a socket"


async def test_market_closed_status_is_distinct_from_disconnected(monkeypatch):
    hub, adapters, calls = _hub_harness(monkeypatch)
    _patch_token(monkeypatch)
    monkeypatch.setattr(fyers_ws, "_market_open", lambda: False)
    ws = FakeWebSocket()

    task = asyncio.create_task(fyers_ws.ws_fyers_ticks(ws, symbol="NIFTY"))
    await _wait_for(lambda: _has_state(ws, "market_closed"))
    status = next(f for f in _frames(ws, "status") if f["state"] == "market_closed")
    assert status["market_open"] is False
    assert not _has_state(ws, "disconnected")
    await _stop(task)


async def test_client_disconnect_without_ticks_releases_subscription(monkeypatch):
    """A silent feed must not pin the hub connection after the client leaves."""
    hub, adapters, calls = _hub_harness(monkeypatch)
    _patch_token(monkeypatch)
    ws = FakeWebSocket()

    task = asyncio.create_task(fyers_ws.ws_fyers_ticks(ws, symbol="NIFTY"))
    await _wait_for(lambda: hub.subscriber_count("fyers") == 1)

    ws.drop()
    await _wait_for(lambda: hub.subscriber_count("fyers") == 0)
    assert adapters["fyers"].disconnected == 1
    await asyncio.wait_for(task, timeout=1.0)



async def test_shutdown_clears_subscription_without_hanging(monkeypatch):
    hub, adapters, calls = _hub_harness(monkeypatch)
    _patch_token(monkeypatch)

    task = asyncio.create_task(fyers_ws.ws_fyers_ticks(FakeWebSocket(), symbol="NIFTY"))
    await _wait_for(lambda: hub.subscriber_count("fyers") == 1)

    await asyncio.wait_for(asyncio.to_thread(fyers_ws.shutdown), timeout=1.0)

    assert hub.subscriber_count("fyers") == 0
    assert adapters["fyers"].disconnected == 1
    await _stop(task)



async def test_upstream_error_surfaces_reconnecting_then_reconnects(monkeypatch):
    hub, adapters, calls = _hub_harness(monkeypatch)
    _patch_token(monkeypatch)
    monkeypatch.setattr(fyers_ws, "_BACKOFF_BASE", 0.01)
    monkeypatch.setattr(fyers_ws, "_BACKOFF_CAP", 0.02)
    monkeypatch.setattr(fyers_ws, "_RECONNECT_MAX", 3)
    ws = FakeWebSocket()

    task = asyncio.create_task(fyers_ws.ws_fyers_ticks(ws, symbol="NIFTY"))
    await _wait_for(lambda: hub.subscriber_count("fyers") == 1)

    adapters["fyers"].fail("socket dropped")

    await _wait_for(lambda: _has_state(ws, "reconnecting"))
    await _wait_for(lambda: calls["factory"] >= 2)
    await _wait_for(lambda: _has_state(ws, "connected"))
    await _stop(task)



def test_router_registered_on_app(monkeypatch):
    monkeypatch.setattr(fyers_ws, "_resolve_token", lambda: (None, "no_token"))
    from api_server_fastapi import app

    client = TestClient(app)
    try:
        with client.websocket_connect("/ws/fyers/ticks?symbol=NIFTY") as ws:
            frame = ws.receive_json()
    finally:
        client.close()

    assert frame["type"] == "status"
    assert frame["state"] == "disconnected"

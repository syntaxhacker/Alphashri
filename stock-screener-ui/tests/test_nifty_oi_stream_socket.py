"""The Upstox socket must be closed when an OI-stream session ends.

``MarketDataStreamerV3.connect()`` returns IMMEDIATELY (the SDK owns the
socket on its own thread), so the streamer's socket stayed open for the life
of the process. The task re-subscribes every ``RESOLVE_EVERY_SEC`` (15 min),
so every cycle leaked one Upstox WebSocket + its thread.
"""

import asyncio
import queue
import sys
import threading
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.reports_api import nifty_oi_stream  # noqa: E402


class _FakeStreamer:
    def __init__(self, *a, **k):
        self.disconnected = False
        self.connected = False

    def on(self, *a, **k):
        pass

    def subscribe(self, *a, **k):
        pass

    def connect(self):
        self.connected = True

    def disconnect(self):
        self.disconnected = True


def test_disconnect_helper_closes_the_socket():
    streamer = _FakeStreamer()
    nifty_oi_stream._disconnect(streamer)
    assert streamer.disconnected is True


def test_disconnect_helper_is_safe_with_no_streamer():
    nifty_oi_stream._disconnect(None)  # must not raise


def test_disconnect_helper_swallows_a_failing_disconnect():
    class _Boom:
        def disconnect(self):
            raise RuntimeError("socket already gone")

    nifty_oi_stream._disconnect(_Boom())  # must not raise


def test_run_ws_hands_the_streamer_back(monkeypatch):
    import upstox_client
    import api.paper.live_stream as live_stream

    monkeypatch.setattr(live_stream, "_get_upstox_token", lambda: "token")
    monkeypatch.setattr(upstox_client, "MarketDataStreamerV3", _FakeStreamer)

    streamer = nifty_oi_stream._run_ws(
        {"NSE_FO|1": (100.0, "ce")}, queue.Queue(), threading.Event()
    )
    assert isinstance(streamer, _FakeStreamer)
    assert streamer.connected is True


async def test_task_closes_the_socket_when_it_stops(monkeypatch):
    made: list[_FakeStreamer] = []

    def _fake_run_ws(key_map, q, closed):
        streamer = _FakeStreamer()
        made.append(streamer)
        return streamer

    monkeypatch.setattr(nifty_oi_stream, "ENABLED", True)
    monkeypatch.setattr(nifty_oi_stream, "START_DELAY_SEC", 0.0)
    monkeypatch.setattr(nifty_oi_stream, "_run_ws", _fake_run_ws)
    monkeypatch.setattr(
        nifty_oi_stream,
        "_resolve_subscriptions",
        lambda: (["NSE_FO|1"], {"NSE_FO|1": (100.0, "ce")}),
    )
    monkeypatch.setattr("trading.utils.is_market_open", lambda *a, **k: True)

    task = asyncio.create_task(nifty_oi_stream.nifty_oi_stream_task())
    try:
        await asyncio.sleep(0.2)
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    assert made, "the WS session must have started"
    assert made[0].disconnected is True

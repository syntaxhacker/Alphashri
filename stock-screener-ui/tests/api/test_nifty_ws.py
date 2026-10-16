"""Tests for the Nifty report WebSocket push endpoints.

Uses a minimal FastAPI app with only ``nifty_ws.router`` mounted, so the
full API lifespan (background tasks, DB, Redis) never runs.
"""

import uuid
from unittest.mock import AsyncMock, patch

import asyncio

import pytest
from fastapi import FastAPI, WebSocketDisconnect
from fastapi.testclient import TestClient

from api.reports_api import nifty as nifty_report
from api.reports_api import nifty_stream
from api.reports_api import nifty_ws as nifty_ws_module
from api.reports_api.nifty_ws import router as nifty_ws_router


def _make_client() -> TestClient:
    app = FastAPI()
    app.include_router(nifty_ws_router)
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clear_live_cache():
    """The WS goes through the shared 5s `get_cached_live` — clear it per test
    so a monkeypatched `_compute_live` is actually exercised."""
    nifty_report._live_cache.clear()
    nifty_report._live_ws_cache.clear()
    yield
    nifty_report._live_cache.clear()
    nifty_report._live_ws_cache.clear()


def _tiny_report() -> dict:
    return {"mode": "live", "spot": 22700.0, "fetched_at": "2026-10-16T10:00:00+05:30"}


def test_report_first_frame():
    client = _make_client()
    report = _tiny_report()
    with patch(
        "api.reports_api.nifty._compute_live",
        new=AsyncMock(return_value=report),
    ):
        with client.websocket_connect("/ws/nifty/report") as ws:
            frame = ws.receive_json()
    assert frame == {"type": "report", "data": report}


def test_report_first_frame_with_expiry_param():
    client = _make_client()
    report = _tiny_report()
    compute = AsyncMock(return_value=report)
    with patch("api.reports_api.nifty._compute_live", new=compute):
        with client.websocket_connect("/ws/nifty/report?expiry=2026-10-29") as ws:
            frame = ws.receive_json()
    assert frame["type"] == "report"
    assert frame["data"] == report
    compute.assert_called_with("2026-10-29")


def test_report_compute_failure_sends_error_and_survives():
    client = _make_client()
    good = _tiny_report()
    compute = AsyncMock(side_effect=[RuntimeError("boom"), good])
    with patch("api.reports_api.nifty._compute_live", new=compute):
        with client.websocket_connect("/ws/nifty/report") as ws:
            err = ws.receive_json()
            assert err["type"] == "error"
            assert "boom" in err["message"]
            # Loop stays alive: the next 2s tick pushes the good report.
            # (An aux frame may interleave — skip past it.)
            for _ in range(5):
                nxt = ws.receive_json()
                if nxt.get("type") == "aux":
                    continue
                break
            assert nxt == {"type": "report", "data": good}


def test_bursts_snapshot_and_live_event():
    client = _make_client()
    snap_id = f"test-snap-{uuid.uuid4()}"
    live_id = f"test-live-{uuid.uuid4()}"
    snapshot_event = {"id": snap_id, "severity": "info", "detail": "pre-connect"}
    nifty_stream.publish([snapshot_event])
    try:
        with client.websocket_connect("/ws/nifty/bursts") as ws:
            snapshot = ws.receive_json()
            assert snapshot["type"] == "snapshot"
            assert snapshot_event in snapshot["data"]

            live_event = {"id": live_id, "severity": "info", "detail": "post-connect"}
            nifty_stream.publish([live_event])
            burst = ws.receive_json()
            assert burst == {"type": "burst", "data": live_event}
    finally:
        # Keep the bounded deque clean for other tests.
        nifty_stream._seen_ids.discard(snap_id)
        nifty_stream._seen_ids.discard(live_id)


@pytest.mark.parametrize("path", ["/ws/nifty/report?token=bad-token", "/ws/nifty/bursts?token=bad-token"])
def test_invalid_token_closes_socket(path):
    client = _make_client()
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect(path) as ws:
            ws.receive_json()
    assert exc_info.value.code == 1008


def _tiny_tape_raw() -> list[dict]:
    return [
        {"t": "2026-10-16T09:15:00+05:30", "spot": 22700.0,
         "ce_oi": 1000, "pe_oi": 1200, "ce_vol": 500, "pe_vol": 600,
         "pcr_oi": 1.2, "strikes_top": [{"strike": 22700}]},
        {"t": "2026-10-16T09:16:00+05:30", "spot": 22710.0,
         "ce_oi": 1100, "pe_oi": 1250, "ce_vol": 700, "pe_vol": 650,
         "pcr_oi": 1.14, "strikes_top": [{"strike": 22700}]},
    ]


def _tiny_sensex() -> dict:
    return {"symbol": "SENSEX", "expiry": "2026-10-20", "spot": 81400.0,
            "fetched_at": "2026-10-16T10:00:00+05:30"}


def test_aux_frame_has_tape_and_sensex():
    client = _make_client()
    report = _tiny_report()
    sensex = _tiny_sensex()
    nifty_report._sensex_cache.pop("default", None)
    with patch(
        "api.reports_api.nifty._compute_live",
        new=AsyncMock(return_value=report),
    ), patch(
        "api.reports_api.nifty_ws.nifty_report.read_tape",
        return_value=_tiny_tape_raw(),
    ), patch(
        "api.reports_api.nifty._compute_sensex_live",
        new=AsyncMock(return_value=sensex),
    ):
        with client.websocket_connect("/ws/nifty/report") as ws:
            first = ws.receive_json()
            # The existing report frame still arrives first.
            assert first == {"type": "report", "data": report}
            aux = ws.receive_json()
    nifty_report._sensex_cache.pop("default", None)
    assert aux["type"] == "aux"
    assert set(aux["tape"].keys()) == {"date", "interval_sec", "baseline_t", "rows"}
    assert aux["tape"]["interval_sec"] == nifty_report.TAPE_INTERVAL_SEC
    assert len(aux["tape"]["rows"]) == 2
    assert aux["tape"]["baseline_t"] == aux["tape"]["rows"][0]["t"]
    assert aux["sensex"] == sensex


def test_aux_frame_nulls_when_no_tape_and_sensex_fails():
    client = _make_client()
    report = _tiny_report()
    nifty_report._sensex_cache.pop("default", None)
    with patch(
        "api.reports_api.nifty._compute_live",
        new=AsyncMock(return_value=report),
    ), patch(
        "api.reports_api.nifty_ws.nifty_report.read_tape",
        return_value=[],
    ), patch(
        "api.reports_api.nifty._compute_sensex_live",
        new=AsyncMock(side_effect=RuntimeError("sensex down")),
    ):
        with client.websocket_connect("/ws/nifty/report") as ws:
            first = ws.receive_json()
            assert first == {"type": "report", "data": report}
            aux = ws.receive_json()
    nifty_report._sensex_cache.pop("default", None)
    assert aux == {"type": "aux", "tape": None, "sensex": None}


@pytest.fixture
def _reset_spot_state():
    """Save/restore the shared SPOT poller state so tick tests are isolated."""
    saved_spot = dict(nifty_ws_module._last_spot)
    saved_day_open = nifty_ws_module._day_open
    saved_task = nifty_ws_module._spot_tick_task
    nifty_ws_module._spot_tick_task = None
    yield
    nifty_ws_module._reset_spot_state_for_tests()
    with nifty_ws_module._spot_lock:
        nifty_ws_module._last_spot.update(saved_spot)
    nifty_ws_module._day_open = saved_day_open
    try:
        task = nifty_ws_module._spot_tick_task
        if task is not None and not task.done():
            task.cancel()
    except Exception:
        pass
    nifty_ws_module._spot_tick_task = saved_task


def test_tick_frame_emitted_when_spot_available(_reset_spot_state):
    client = _make_client()
    report = _tiny_report()
    tick_ts = "2026-10-16T10:00:01+05:30"
    with patch.object(
        nifty_ws_module,
        "_last_spot",
        {"spot": 22750.0, "ts": tick_ts, "change_pct": 0.22},
    ), patch(
        "api.reports_api.nifty._compute_live",
        new=AsyncMock(return_value=report),
    ):
        with client.websocket_connect("/ws/nifty/report") as ws:
            # The existing report frame must still arrive first.
            first = ws.receive_json()
            assert first == {"type": "report", "data": report}
            # Aux is always second on connect; the tick follows on the
            # first 2s loop iteration (spot is already available).
            second = ws.receive_json()
            assert second["type"] == "aux"
            tick = ws.receive_json()
    assert tick == {
        "type": "tick",
        "spot": 22750.0,
        "ts": tick_ts,
        "change_pct": 0.22,
    }


def test_no_tick_frame_when_spot_unavailable(_reset_spot_state, monkeypatch):
    """With no SPOT reading the loop emits heartbeats but never a tick."""
    monkeypatch.setattr(nifty_ws_module, "REPORT_INTERVAL_SEC", 0.05)
    monkeypatch.setattr(nifty_ws_module, "REPORT_HEARTBEAT_SEC", 0.05)
    client = _make_client()
    report = _tiny_report()
    nifty_ws_module._reset_spot_state_for_tests()
    nifty_report._sensex_cache.pop("default", None)
    with patch(
        "api.reports_api.nifty._compute_live",
        new=AsyncMock(return_value=report),
    ), patch(
        "api.reports_api.nifty_ws.nifty_report.read_tape",
        return_value=[],
    ), patch(
        "api.reports_api.nifty._compute_sensex_live",
        new=AsyncMock(side_effect=RuntimeError("sensex down")),
    ):
        with client.websocket_connect("/ws/nifty/report") as ws:
            first = ws.receive_json()
            assert first == {"type": "report", "data": report}
            second = ws.receive_json()
            assert second == {"type": "aux", "tape": None, "sensex": None}
            # No spot -> the next prompt frames are heartbeats, never ticks.
            for _ in range(3):
                frame = ws.receive_json()
                assert frame["type"] == "heartbeat"
    nifty_report._sensex_cache.pop("default", None)
    assert nifty_ws_module.latest_spot()["spot"] is None


def test_tick_sent_only_once_when_spot_unchanged(_reset_spot_state, monkeypatch):
    """A tick fires once per spot change; steady spot yields heartbeats."""
    monkeypatch.setattr(nifty_ws_module, "REPORT_INTERVAL_SEC", 0.05)
    monkeypatch.setattr(nifty_ws_module, "REPORT_HEARTBEAT_SEC", 0.05)
    client = _make_client()
    report = _tiny_report()
    tick_ts = "2026-10-16T10:00:01+05:30"
    nifty_report._sensex_cache.pop("default", None)
    with patch.object(
        nifty_ws_module,
        "_last_spot",
        {"spot": 22750.0, "ts": tick_ts, "change_pct": 0.22},
    ), patch(
        "api.reports_api.nifty._compute_live",
        new=AsyncMock(return_value=report),
    ), patch(
        "api.reports_api.nifty_ws.nifty_report.read_tape",
        return_value=[],
    ), patch(
        "api.reports_api.nifty._compute_sensex_live",
        new=AsyncMock(side_effect=RuntimeError("sensex down")),
    ):
        with client.websocket_connect("/ws/nifty/report") as ws:
            assert ws.receive_json() == {"type": "report", "data": report}
            assert ws.receive_json() == {"type": "aux", "tape": None, "sensex": None}
            frames = [ws.receive_json() for _ in range(4)]
    nifty_report._sensex_cache.pop("default", None)
    ticks = [f for f in frames if f.get("type") == "tick"]
    assert len(ticks) == 1
    assert ticks[0] == {
        "type": "tick",
        "spot": 22750.0,
        "ts": tick_ts,
        "change_pct": 0.22,
    }
    assert all(f["type"] == "heartbeat" for f in frames if f.get("type") != "tick")


async def test_spot_tick_task_market_hours_gated(_reset_spot_state, monkeypatch):
    """When the market is closed the poller must not call get_spot_price."""
    monkeypatch.setattr("trading.utils.is_market_open", lambda *a, **k: False)
    calls: list = []

    async def _counter(underlying: str):
        calls.append(underlying)
        return {"status": "ok", "underlying": underlying, "spot": 22700.0}

    monkeypatch.setattr("api.options.get_spot_price", _counter)
    task = asyncio.create_task(nifty_ws_module.nifty_spot_tick_task(interval_sec=0.01))
    try:
        await asyncio.sleep(0.05)
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    assert calls == []


async def test_spot_tick_task_never_raises_on_poll_error(
    _reset_spot_state, monkeypatch
):
    """A failing get_spot_price keeps the previous value and never raises."""
    monkeypatch.setattr("trading.utils.is_market_open", lambda *a, **k: True)

    async def _raiser(underlying: str):
        raise RuntimeError("upstox down")

    monkeypatch.setattr("api.options.get_spot_price", _raiser)
    task = asyncio.create_task(nifty_ws_module.nifty_spot_tick_task(interval_sec=0.01))
    try:
        await asyncio.sleep(0.05)
        assert not task.done(), "poller task must survive poll errors"
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    assert nifty_ws_module.latest_spot()["spot"] is None


async def test_spot_tick_task_stores_spot_and_change_pct(
    _reset_spot_state, monkeypatch
):
    """On success the poller publishes spot + day-open-relative change_pct."""
    monkeypatch.setattr("trading.utils.is_market_open", lambda *a, **k: True)

    async def _ok(underlying: str):
        assert underlying == "NIFTY"
        return {"status": "ok", "underlying": underlying, "spot": 22700.0}

    monkeypatch.setattr("api.options.get_spot_price", _ok)
    task = asyncio.create_task(nifty_ws_module.nifty_spot_tick_task(interval_sec=0.01))
    try:
        await asyncio.sleep(0.05)
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    snap = nifty_ws_module.latest_spot()
    assert snap["spot"] == 22700.0
    assert snap["ts"] is not None
    assert snap["change_pct"] == 0.0  # first reading is its own baseline


async def test_start_nifty_spot_tick_task_is_idempotent(
    _reset_spot_state, monkeypatch
):
    """Double-start returns the running task instead of spawning a second."""
    monkeypatch.setattr("trading.utils.is_market_open", lambda *a, **k: False)
    first = nifty_ws_module.start_nifty_spot_tick_task(interval_sec=0.01)
    second = nifty_ws_module.start_nifty_spot_tick_task(interval_sec=0.01)
    try:
        assert first is second
        assert not first.done()
    finally:
        first.cancel()
        try:
            await first
        except asyncio.CancelledError:
            pass


def test_report_uses_live_path_when_md_live():
    """With nifty_md live the WS serves get_live_report (report frame first)."""
    client = _make_client()
    report = _tiny_report()
    live = AsyncMock(return_value=report)
    with patch("api.reports_api.nifty.get_live_report", new=live):
        with client.websocket_connect("/ws/nifty/report?expiry=2026-10-29") as ws:
            frame = ws.receive_json()
    assert frame == {"type": "report", "data": report}
    live.assert_called_with("2026-10-29")

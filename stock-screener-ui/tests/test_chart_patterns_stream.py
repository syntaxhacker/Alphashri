"""SSE streaming tests for /api/chart-patterns results/watch streams.

Parses the SSE body (``event: <name>`` / ``data: <json>`` frames), asserting:
meta arrives before any item, streamed items match the batch endpoint shape
(byte-identical per card), and ``done`` is last. A gated candle fetch proves
results items stream progressively (fast cards arrive while a slow fetch is
still blocked) rather than all at the end.
"""
import asyncio
import json
import threading

import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

import api.chart_patterns as cp_api
from api.auth import get_current_user
from api.chart_patterns import router
from chart_patterns import jobs, store
from db.database import get_db


class _FakeUser:
    id = 1
    email = "qa@test.com"


def _make_df(n: int = 80) -> pd.DataFrame:
    idx = pd.date_range("2026-01-01", periods=n, freq="D", tz="UTC")
    base = np.linspace(100.0, 130.0, n)
    return pd.DataFrame(
        {"open": base, "high": base + 1.0, "low": base - 1.0, "close": base, "volume": 1000.0},
        index=idx,
    )


def _hit(symbol: str, name: str = "Test Co") -> dict:
    return {
        "symbol": symbol,
        "name": name,
        "timeframe": "1D",
        "pattern_id": "falling_wedge",
        "pattern_name": "Falling Wedge",
        "family": "reversal",
        "direction": "bullish",
        "status": "confirmed",
        "quality": "strong",
        "confidence": 78.4,
        "start_date": "2026-04-26",
        "end_date": "2026-09-26",
        "start_price": 129.8,
        "end_price": 112.6,
        "breakout_level": 112.6,
        "target": 129.6,
        "stop": 102.5,
        "rr": 1.7,
        "bars_ago": 1,
        "volume_confirmed": True,
        "trendlines": [[{"t": "2026-04-26", "price": 129.8}, {"t": "2026-09-26", "price": 112.6}]],
        "notes": "synthetic",
    }


def _armed_row(symbol: str) -> dict:
    return {
        "symbol": symbol,
        "setup_id": "breakout",
        "trigger_level": 100.0,
        "invalidate_level": 90.0,
        "base_days": 70,
        "range_pct": 10.0,
        "confidence": 80.0,
        "status": "forming",
        "end_date": "2026-09-26",
        "fresh": False,
    }


@pytest.fixture
def cp_client(test_db_engine):
    factory = sessionmaker(autocommit=False, autoflush=False, bind=test_db_engine)
    store.set_session_factory(factory)
    jobs.reset()

    app = FastAPI()
    app.include_router(router)

    def override_get_db():
        session = factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = lambda: _FakeUser()

    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        jobs.reset()
        store.reset_session_factory()


def _parse_sse(body: str) -> list:
    """Split an SSE body into ``(event, data)`` frames (heartbeats kept)."""
    events = []
    for chunk in body.split("\n\n"):
        chunk = chunk.strip()
        if not chunk:
            continue
        name, data = None, None
        for line in chunk.splitlines():
            if line.startswith("event:"):
                name = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                data = line.split(":", 1)[1].strip()
        events.append((name, json.loads(data) if data else None))
    return events


def _parse_one(frame: str):
    parsed = _parse_sse(frame)
    assert len(parsed) == 1, f"expected one SSE frame, got: {frame!r}"
    return parsed[0]


def _no_heartbeat(events: list) -> list:
    return [(name, data) for name, data in events if name != "heartbeat"]


# ---------------------------------------------------------------------------
# /results/stream
# ---------------------------------------------------------------------------


def test_results_stream_meta_items_done_match_batch(cp_client, monkeypatch):
    store.save_job({
        "job_id": "cpj_stream", "universe": "nifty500", "timeframe": "1D",
        "status": "completed", "total": 500, "done": 500,
    })
    store.save_hits("cpj_stream", [_hit("AAA"), _hit("BBB", name="B Co"), _hit("CCC")])
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: _make_df(80))
    monkeypatch.setattr(
        cp_api.trendlines_mod, "detect_trendlines",
        lambda df, lookback_bars=None: {"support": None, "resistance": None},
    )

    batch = cp_client.get("/api/chart-patterns/results", params={"job_id": "cpj_stream"})
    assert batch.status_code == 200
    batch_items = {item["symbol"]: item for item in batch.json()["items"]}

    resp = cp_client.get("/api/chart-patterns/results/stream", params={"job_id": "cpj_stream"})
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]
    events = _no_heartbeat(_parse_sse(resp.text))
    assert events, "expected SSE frames"

    # meta arrives before any item.
    assert events[0][0] == "meta"
    meta = events[0][1]
    assert meta["total"] == batch.json()["total"] == 3
    assert meta["summary"] == batch.json()["summary"]
    assert meta["data_through"] == batch.json()["data_through"]

    # done is last; every card streams exactly once.
    assert events[-1] == ("done", {})
    streamed = [data for name, data in events[1:-1]]
    assert all(name == "item" for name, _ in events[1:-1])
    assert {item["symbol"] for item in streamed} == {"AAA", "BBB", "CCC"}

    # Streamed cards are byte-identical (same dict) to the batch items.
    for item in streamed:
        assert item == batch_items[item["symbol"]]

    # Well-formed card shape.
    for item in streamed:
        assert item["candles"] and item["last_close"] is not None
        assert isinstance(item["trend_lines"], list)


def test_results_stream_items_arrive_progressively(monkeypatch):
    """Fast cards stream while a slow candle fetch is still blocked."""
    gate = threading.Event()

    def _fetch(symbol, timeframe, **kwargs):
        if symbol == "SLOW":
            assert gate.wait(timeout=10), "SLOW fetch must be released by the test"
        return _make_df(80)

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _fetch)
    monkeypatch.setattr(
        cp_api.trendlines_mod, "detect_trendlines",
        lambda df, lookback_bars=None: {"support": None, "resistance": None},
    )
    items = [_hit("SLOW"), _hit("FAST"), _hit("MID")]

    async def _main():
        gen = cp_api._results_sse_events(
            [dict(it) for it in items], default_timeframe="1D", lookback_bars=None,
            compute_trendlines=True, total=3, summary={}, data_through=None,
            request=None,
        )
        events = [_parse_one(await gen.__anext__())]
        # SLOW is still blocked on the gate: the next frame must already be a
        # fast card, proving items stream as each enrichment completes.
        nxt = _parse_one(await asyncio.wait_for(gen.__anext__(), timeout=10))
        events.append(nxt)
        assert nxt[0] == "item" and nxt[1]["symbol"] in ("FAST", "MID")
        gate.set()
        async for frame in gen:
            events.append(_parse_one(frame))
        return events

    events = asyncio.run(_main())
    try:
        assert events[0][0] == "meta"
        assert events[-1] == ("done", {})
        assert {data["symbol"] for name, data in events if name == "item"} == {"SLOW", "FAST", "MID"}
        assert not [e for e in events if e[0] == "error"]
    finally:
        gate.set()


def test_results_stream_empty_results_meta_then_done(cp_client, monkeypatch):
    store.save_job({
        "job_id": "cpj_stream_empty", "universe": "nifty500", "timeframe": "1D",
        "status": "completed",
    })
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: _make_df(80))

    resp = cp_client.get(
        "/api/chart-patterns/results/stream",
        params={"job_id": "cpj_stream_empty", "pattern_id": "does_not_exist"},
    )
    assert resp.status_code == 200
    events = _no_heartbeat(_parse_sse(resp.text))
    assert events[0][0] == "meta"
    assert events[0][1]["total"] == 0
    assert events[-1] == ("done", {})


def test_results_stream_store_failure_emits_error(cp_client, monkeypatch):
    def _boom(*args, **kwargs):
        raise RuntimeError("store exploded")

    monkeypatch.setattr(store, "query_results", _boom)

    resp = cp_client.get("/api/chart-patterns/results/stream", params={"job_id": "cpj_any"})
    assert resp.status_code == 200
    events = _no_heartbeat(_parse_sse(resp.text))
    assert len(events) == 1
    assert events[0][0] == "error"
    assert "store exploded" in events[0][1]["message"]
    # Existing batch endpoint is unchanged (still propagates the failure).
    with pytest.raises(RuntimeError, match="store exploded"):
        cp_client.get("/api/chart-patterns/results", params={"job_id": "cpj_any"})


# ---------------------------------------------------------------------------
# /watch/stream
# ---------------------------------------------------------------------------


def test_watch_stream_live_rows(cp_client, monkeypatch):
    monkeypatch.setattr(cp_api.watch_mod, "get_snapshot", lambda *a, **k: None)
    monkeypatch.setattr(
        cp_api.watch_mod, "arm",
        lambda setup_id, **kw: [_armed_row("AAA"), _armed_row("BBB")],
    )

    def _live(rows, min_rel_volume=0.7):
        row = dict(rows[0])
        row.update(state="triggered", ltp=101.0, rel_volume=1.2, vol_adj=1.1,
                   pct_to_trigger=1.0)
        return [row]

    monkeypatch.setattr(cp_api.watch_mod, "live", _live)

    resp = cp_client.get("/api/chart-patterns/watch/stream", params={"setup": "breakout"})
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]
    events = _no_heartbeat(_parse_sse(resp.text))

    assert events[0] == ("meta", {"setup": "breakout", "min_rel_volume": 0.7})
    assert events[-1] == ("done", {})
    rows = [data for name, data in events[1:-1]]
    assert len(rows) == 2
    assert all(name == "item" for name, _ in events[1:-1])
    assert {row["symbol"] for row in rows} == {"AAA", "BBB"}
    for row in rows:
        assert row["state"] == "triggered"
        assert row["ltp"] == 101.0
        assert row["trigger_level"] == 100.0


def test_watch_stream_snapshot_path_skips_arm_live(cp_client, monkeypatch):
    snap_rows = [dict(_armed_row("AAA"), state="armed", ltp=None, pct_to_trigger=None)]

    def _snap(*args, **kwargs):
        return {"items": [dict(r) for r in snap_rows]}

    monkeypatch.setattr(cp_api.watch_mod, "get_snapshot", _snap)

    def _boom(*args, **kwargs):
        raise AssertionError("arm/live must not run when a snapshot exists")

    monkeypatch.setattr(cp_api.watch_mod, "arm", _boom)
    monkeypatch.setattr(cp_api.watch_mod, "live", _boom)

    resp = cp_client.get("/api/chart-patterns/watch/stream", params={"setup": "breakout"})
    assert resp.status_code == 200
    events = _no_heartbeat(_parse_sse(resp.text))
    assert events[0][0] == "meta"
    assert events[-1] == ("done", {})
    assert [data for name, data in events[1:-1] if name == "item"] == snap_rows


def test_watch_stream_unknown_setup_404(cp_client):
    resp = cp_client.get("/api/chart-patterns/watch/stream", params={"setup": "nope"})
    assert resp.status_code == 404


def test_watch_stream_live_failure_emits_error(cp_client, monkeypatch):
    monkeypatch.setattr(cp_api.watch_mod, "get_snapshot", lambda *a, **k: None)
    monkeypatch.setattr(cp_api.watch_mod, "arm", lambda setup_id, **kw: [_armed_row("AAA")])

    def _boom(rows, min_rel_volume=0.7):
        raise RuntimeError("live exploded")

    monkeypatch.setattr(cp_api.watch_mod, "live", _boom)

    resp = cp_client.get("/api/chart-patterns/watch/stream", params={"setup": "breakout"})
    assert resp.status_code == 200
    events = _no_heartbeat(_parse_sse(resp.text))
    assert events[0][0] == "meta"
    assert events[-1][0] == "error"
    assert "live exploded" in events[-1][1]["message"]
    assert not [e for e in events if e[0] == "done"]


def test_watch_stream_empty_arm_meta_then_done(cp_client, monkeypatch):
    monkeypatch.setattr(cp_api.watch_mod, "get_snapshot", lambda *a, **k: None)
    monkeypatch.setattr(cp_api.watch_mod, "arm", lambda setup_id, **kw: [])

    resp = cp_client.get("/api/chart-patterns/watch/stream", params={"setup": "breakout"})
    assert resp.status_code == 200
    events = _no_heartbeat(_parse_sse(resp.text))
    assert events[0][0] == "meta"
    assert events[-1] == ("done", {})

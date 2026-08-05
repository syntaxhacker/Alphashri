"""
Tests for the autoresearch experiment API (/api/experiments/*).

Strategy:
- No real Upstox calls, no writes outside a tmp dir: the engine's data loader
  factory (``api.experiment_routes._make_data_loader``) is monkeypatched to return
  synthetic candles, and ``SESSIONS_DIR`` is redirected to a tmp dir.
- Auth is satisfied by overriding ``get_current_user`` with a SimpleNamespace.
- Background runs are polled via GET /state until completed (TestClient keeps the
  app's asyncio loop alive between requests, so the engine task progresses).
"""

import sys
import time
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.auth import get_current_user
from api import experiment_routes
from api.experiment_routes import router as experiment_router
from trading import autoresearch_engine

ALL_STRATEGIES = {
    "orb", "sr_breakout", "ema_cross", "supertrend", "bollinger", "short", "volume_surge",
}


def make_candles(days: int = 3, tf_minutes: int = 5) -> pd.DataFrame:
    """Synthetic tz-aware IST index OHLCV data (steadily rising -> ORB wins)."""
    import config

    idx = []
    base = pd.Timestamp("2026-01-05 09:15", tz=config.IST)
    for d in range(days):
        day = base + pd.Timedelta(days=d)
        times = pd.date_range(day, day + pd.Timedelta(hours=6, minutes=15), freq=f"{tf_minutes}min")
        idx.extend(times)
    n = len(idx)
    close = 100 + np.arange(n) * 0.05
    return pd.DataFrame(
        {
            "open": close,
            "high": close + 0.2,
            "low": close - 0.2,
            "close": close,
            "volume": np.full(n, 10000),
        },
        index=pd.DatetimeIndex(idx),
    )


def start_payload(session: str, **overrides) -> dict:
    payload = {
        "session": session,
        "strategy": "orb",
        "symbols": ["TEST"],
        "tf": 5,
        "param_space": {"sl_pct": [0.5, 1.0], "tp_pct": [1.5]},
    }
    payload.update(overrides)
    return payload


def _wait_state(client, session: str, timeout: float = 15.0, expected=("completed", "error", "cancelled")) -> dict:
    deadline = time.time() + timeout
    state = {}
    while time.time() < deadline:
        resp = client.get(f"/api/experiments/{session}/state")
        state = resp.json()
        if state.get("status") in expected:
            return state
        time.sleep(0.05)
    return state


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(autoresearch_engine, "SESSIONS_DIR", tmp_path / "sessions")
    (tmp_path / "sessions").mkdir(parents=True, exist_ok=True)

    def fake_loader(tf):
        return {"TEST": make_candles()}

    monkeypatch.setattr(experiment_routes, "_make_data_loader", lambda *a, **k: fake_loader)

    experiment_routes._engines.clear()

    app = FastAPI()
    app.include_router(experiment_router)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()


class TestStartAndState:

    def test_start_returns_started_with_total(self, client):
        resp = client.post("/api/experiments/start", json=start_payload("s_ok"))
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "started"
        assert data["session"] == "s_ok"
        assert data["total"] == 2

    def test_state_reaches_completed(self, client):
        client.post("/api/experiments/start", json=start_payload("s_state"))
        state = _wait_state(client, "s_state")
        assert state["status"] == "completed"
        assert state["total"] == 2
        assert state["current"] == 2
        assert state["strategy"] == "orb"
        assert state["symbols"] == ["TEST"]
        assert state["tf"] == 5
        assert "best_pf" in state

    def test_state_unknown_session_is_idle(self, client):
        state = client.get("/api/experiments/nope/state").json()
        assert state["status"] == "idle"

    def test_start_accepts_mixed_scalar_and_list_params(self, client):
        """Fixed (scalar) params mixed with swept (list) params must not 500."""
        payload = start_payload("s_mixed", param_space={
            "sl_pct": [0.5, 1.0],
            "tp_pct": 1.5,
            "shorts": False,
        })
        resp = client.post("/api/experiments/start", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "started"
        # grid = 2 (sl_pct) x 1 (tp_pct scalar) x 1 (shorts scalar)
        assert data["total"] == 2
        state = _wait_state(client, "s_mixed")
        assert state["status"] == "completed"
        assert state["current"] == 2

    def test_start_with_only_scalar_params(self, client):
        payload = start_payload("s_scalars", param_space={
            "sl_pct": 1.0,
            "tp_pct": 1.5,
            "shorts": False,
        })
        resp = client.post("/api/experiments/start", json=payload)
        assert resp.status_code == 200
        assert resp.json()["total"] == 1
        state = _wait_state(client, "s_scalars")
        assert state["status"] == "completed"
        assert state["current"] == 1


class TestResults:

    def test_results_returns_runs_with_statuses(self, client):
        client.post("/api/experiments/start", json=start_payload("s_res"))
        _wait_state(client, "s_res")

        runs = client.get("/api/experiments/s_res/results").json()
        assert isinstance(runs, list)
        assert len(runs) == 2
        statuses = {r["status"] for r in runs}
        assert statuses == {"keep", "discard"}
        for run in runs:
            assert run.get("run") in (1, 2)
            assert "metrics" in run
            assert "config" in run

    def test_results_empty_for_unknown_session(self, client):
        assert client.get("/api/experiments/ghost/results").json() == []


class TestPauseResumeCancel:

    def test_pause_resume_cancel_wire_to_engine(self, client, monkeypatch):
        """Route-level wiring: pause/resume/cancel call the session engine.

        Uses a controllable stub engine because, under TestClient, a blocking
        (network-backed) loader starves concurrent requests, so pausing a real
        run mid-flight over HTTP is not deterministic.
        """
        calls = []

        class StubEngine:
            def __init__(self):
                self.running = True
                self.paused_flag = False

            def is_running(self, session):
                calls.append("is_running")
                return self.running

            def is_paused(self, session):
                calls.append("is_paused")
                return self.paused_flag

            def pause(self, session, user_id):
                calls.append("pause")
                self.paused_flag = True
                return {"status": "paused", "session": session}

            def resume(self, session, user_id):
                calls.append("resume")
                self.paused_flag = False
                return {"status": "resumed", "session": session}

            def cancel(self, session, user_id):
                calls.append("cancel")
                return {"status": "cancelled", "session": session}

        stub = StubEngine()
        monkeypatch.setattr(experiment_routes, "_get_engine", lambda session: stub)

        pause = client.post("/api/experiments/s_pause/pause")
        assert pause.status_code == 200
        assert pause.json()["status"] == "paused"

        resume = client.post("/api/experiments/s_pause/resume")
        assert resume.status_code == 200
        assert resume.json()["status"] == "resumed"

        cancel = client.post("/api/experiments/s_pause/cancel")
        assert cancel.status_code == 200
        assert cancel.json()["status"] == "cancelled"

        assert "pause" in calls and "resume" in calls and "cancel" in calls

    def test_pause_not_running_is_graceful(self, client, monkeypatch):
        class StubEngine:
            def is_running(self, session):
                return False

            def is_paused(self, session):
                return False

        monkeypatch.setattr(experiment_routes, "_get_engine", lambda session: StubEngine())
        assert client.post("/api/experiments/s_done/pause").json()["status"] == "not_running"
        assert client.post("/api/experiments/s_done/resume").json()["status"] == "not_paused"

    def test_real_engine_pause_blocks_and_resume_finishes(self, tmp_path, monkeypatch):
        """Direct engine-semantics test (deterministic).

        ``engine.start`` only schedules the run task; pausing immediately after it
        clears the pause event before the loop runs the task, so the run blocks on
        its first ``await pause_event.wait()``. Resume releases it and the run
        evaluates every candidate.
        """
        import asyncio

        monkeypatch.setattr(autoresearch_engine, "SESSIONS_DIR", tmp_path / "sessions")
        calls = {"n": 0}

        def loader(tf):
            calls["n"] += 1
            return {"TEST": make_candles()}

        engine = autoresearch_engine.AutoresearchEngine(loader)

        async def scenario():
            result = engine.start(
                "s_pause_real", 1, "orb", ["TEST"], 5,
                {"sl_pct": [0.5, 1.0, 1.5, 2.0]},
            )
            assert result["status"] == "started"
            task = engine._tasks["s_pause_real"]

            engine.pause("s_pause_real", 1)
            await asyncio.sleep(0.05)
            assert calls["n"] == 0  # paused: run never evaluated a candidate

            engine.resume("s_pause_real", 1)
            await task
            assert calls["n"] == 4

        asyncio.run(scenario())
        assert engine.get_status("s_pause_real", 1)["status"] == "completed"

    def test_cancel(self, client):
        client.post("/api/experiments/start", json=start_payload("s_cancel"))
        cancel = client.post("/api/experiments/s_cancel/cancel")
        assert cancel.status_code == 200
        assert cancel.json()["status"] == "cancelled"


class TestValidation:

    def test_empty_symbols_rejected(self, client):
        resp = client.post("/api/experiments/start", json=start_payload("s_bad", symbols=[]))
        assert resp.status_code == 400
        assert "symbols" in resp.json()["detail"]

    def test_unknown_strategy_rejected(self, client):
        resp = client.post("/api/experiments/start", json=start_payload("s_bad", strategy="not_a_strategy"))
        assert resp.status_code == 400
        assert "Unknown strategy" in resp.json()["detail"]

    def test_empty_param_space_rejected(self, client):
        resp = client.post("/api/experiments/start", json=start_payload("s_bad", param_space={}))
        assert resp.status_code == 400
        assert "param_space" in resp.json()["detail"]

    def test_oversized_grid_rejected(self, client):
        big_grid = {"sl_pct": list(range(10)), "tp_pct": list(range(60))}
        resp = client.post("/api/experiments/start", json=start_payload("s_big", param_space=big_grid))
        assert resp.status_code == 400
        assert "Grid too large" in resp.json()["detail"]


class TestStrategies:

    def test_strategies_returns_all_seven(self, client):
        resp = client.get("/api/experiments/strategies")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["strategies"]) == 7
        keys = {s["key"] for s in data["strategies"]}
        assert keys == ALL_STRATEGIES
        assert len(data["defaults"]) == 7
        orb = next(s for s in data["strategies"] if s["key"] == "orb")
        assert "params" in orb and orb["params"]


class TestList:

    def test_list_returns_completed_session(self, client):
        client.post("/api/experiments/start", json=start_payload("s_list"))
        _wait_state(client, "s_list")
        sessions = client.get("/api/experiments/list").json()
        assert isinstance(sessions, list)
        entry = next((s for s in sessions if s["session"] == "s_list"), None)
        assert entry is not None
        assert entry["strategy"] == "orb"
        assert entry["tf"] == 5
        assert entry["symbols"] == ["TEST"]
        assert entry["runs"] == 2
        assert entry["status"] in ("running", "completed")


class TestChart:

    def test_chart_returns_echarts_data(self, client, monkeypatch):
        monkeypatch.setattr(experiment_routes, "_load_candles", lambda *a, **k: make_candles())
        client.post("/api/experiments/start", json=start_payload("s_chart"))
        _wait_state(client, "s_chart")

        runs = client.get("/api/experiments/s_chart/results").json()
        run_id = runs[0]["run"]

        resp = client.get(f"/api/experiments/s_chart/chart/{run_id}", params={"symbol": "TEST"})
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("run") == run_id
        assert "candles" in data
        assert "trades" in data
        assert "config" in data
        assert "metrics" in data
        assert len(data["candles"]) > 0

    def test_chart_graceful_error_when_no_candles(self, client, monkeypatch):
        monkeypatch.setattr(experiment_routes, "_load_candles", lambda *a, **k: None)
        client.post("/api/experiments/start", json=start_payload("s_chart_err"))
        _wait_state(client, "s_chart_err")

        resp = client.get("/api/experiments/s_chart_err/chart/1", params={"symbol": "TEST"})
        assert resp.status_code == 200
        data = resp.json()
        assert "error" in data
        assert "run" in data
        assert "trades" in data

    def test_chart_run_not_found_is_graceful(self, client, monkeypatch):
        monkeypatch.setattr(experiment_routes, "_load_candles", lambda *a, **k: None)
        client.post("/api/experiments/start", json=start_payload("s_missing"))
        _wait_state(client, "s_missing")

        resp = client.get("/api/experiments/s_missing/chart/999", params={"symbol": "TEST"})
        assert resp.status_code == 200
        assert "error" in resp.json()


class TestAuth:

    def test_protected_endpoints_require_auth(self, tmp_path):
        app = FastAPI()
        app.include_router(experiment_router)
        with TestClient(app) as unauth:
            assert unauth.get("/api/experiments/list").status_code == 401
            assert unauth.get("/api/experiments/foo/state").status_code == 401
            assert unauth.post("/api/experiments/foo/pause").status_code == 401

    def test_strategies_requires_no_auth(self, tmp_path):
        app = FastAPI()
        app.include_router(experiment_router)
        with TestClient(app) as unauth:
            assert unauth.get("/api/experiments/strategies").status_code == 200

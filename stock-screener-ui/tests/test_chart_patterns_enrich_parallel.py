"""Parallel candle enrichment + ``/watch`` snapshot fast-path.

Market-hours hang fix: ``_enrich_with_candles`` used to fetch one symbol at
a time (``~0.5-3s`` per fetch under contention, so a 24-card ``/results``
page took ``20-40s``). Fetches now fan out over a bounded thread pool while
the per-item enrichment (clamp, series, closes, trendlines) is unchanged.
``GET /watch`` prefers a precomputed ``watch.get_snapshot(...)`` payload and
only falls back to ``arm`` + ``live`` on a miss.
"""

from __future__ import annotations

import threading
import time

import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

import api.chart_patterns as cp_api
from api.auth import get_current_user
from api.chart_patterns import router
from chart_patterns import config, jobs, store
from chart_patterns import watch as watch_mod
from db.database import get_db


def _make_df(n: int = 80) -> pd.DataFrame:
    idx = pd.date_range("2026-01-01", periods=n, freq="D", tz="UTC")
    base = np.linspace(100.0, 130.0, n)
    return pd.DataFrame(
        {"open": base, "high": base + 1.0, "low": base - 1.0, "close": base, "volume": 1000.0},
        index=idx,
    )


def _hit(symbol: str) -> dict:
    return {
        "symbol": symbol,
        "name": f"{symbol} Co",
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


class _FakeUser:
    id = 1
    email = "qa@test.com"


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


# ---------------------------------------------------------------------------
# Enrichment fan-out
# ---------------------------------------------------------------------------


def test_enrich_fetches_concurrently(monkeypatch):
    """A sleeping fetch proves overlap: wall time << serial sum, peak > 1."""
    n = 6
    sleep_s = 0.25
    lock = threading.Lock()
    state = {"in_flight": 0, "peak": 0}

    def _fetch(symbol, timeframe, **kwargs):
        with lock:
            state["in_flight"] += 1
            state["peak"] = max(state["peak"], state["in_flight"])
        try:
            time.sleep(sleep_s)
        finally:
            with lock:
                state["in_flight"] -= 1
        return _make_df(80)

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _fetch)
    monkeypatch.setattr(
        cp_api.trendlines_mod, "detect_trendlines",
        lambda df, lookback_bars=None: {"support": None, "resistance": None},
    )

    items = [_hit(f"SYM{i}") for i in range(n)]
    start = time.monotonic()
    out = cp_api._enrich_with_candles(items, "1D")
    elapsed = time.monotonic() - start

    assert elapsed < n * sleep_s, (
        f"serial fetch suspected: {elapsed:.2f}s for {n} x {sleep_s}s fetches"
    )
    assert state["peak"] > 1, "fetches never overlapped"
    # Order and identity preserved.
    assert [it["symbol"] for it in out] == [f"SYM{i}" for i in range(n)]
    assert all(it["candles"] for it in out)
    assert all(it["last_close"] is not None for it in out)


def test_enrich_dedupes_keys_and_preserves_order(monkeypatch):
    """One fetch per distinct (symbol, timeframe); output order = input."""
    calls: list = []

    def _fetch(symbol, timeframe, **kwargs):
        calls.append((symbol, timeframe, kwargs.get("lookback_bars")))
        return _make_df(80)

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _fetch)
    monkeypatch.setattr(
        cp_api.trendlines_mod, "detect_trendlines",
        lambda df, lookback_bars=None: {"support": None, "resistance": None},
    )

    items = [_hit("AAA"), _hit("BBB"), _hit("AAA"), dict(_hit("CCC"), timeframe="15m")]
    out = cp_api._enrich_with_candles(items, "1D")

    assert [it["symbol"] for it in out] == ["AAA", "BBB", "AAA", "CCC"]
    assert sorted((s, t) for s, t, _ in calls) == [
        ("AAA", "1D"), ("BBB", "1D"), ("CCC", "15m"),
    ]
    assert {lb for _, _, lb in calls} == {config.READ_LOOKBACK_BARS}
    # Duplicate items share the single fetched frame.
    assert out[0]["last_close"] == out[2]["last_close"]


def test_enrich_fetch_error_isolates_item(monkeypatch):
    """A raising fetch blanks only its own key; the rest enrich normally."""

    def _fetch(symbol, timeframe, **kwargs):
        if symbol == "BAD":
            raise RuntimeError("tape exploded")
        return _make_df(80)

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _fetch)
    monkeypatch.setattr(
        cp_api.trendlines_mod, "detect_trendlines",
        lambda df, lookback_bars=None: {"support": None, "resistance": None},
    )

    out = cp_api._enrich_with_candles([_hit("BAD"), _hit("GOOD")], "1D")

    assert out[0]["candles"] == []
    assert out[0]["last_close"] is None
    assert out[0]["day_change_pct"] is None
    assert out[1]["candles"], "healthy item must still enrich"
    assert out[1]["last_close"] is not None


def test_enrich_missing_symbol_passthrough(monkeypatch):
    """Items without a symbol/timeframe keep the old shape (no fetch)."""

    def _boom(symbol, timeframe, **kwargs):
        raise AssertionError("no fetch expected without a key")

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _boom)

    out = cp_api._enrich_with_candles([{"pattern_id": "falling_wedge"}], "1D")

    assert out[0]["candles"] == []
    assert out[0]["last_close"] is None
    assert out[0]["trend_lines"] == []


# ---------------------------------------------------------------------------
# /watch snapshot fast-path
# ---------------------------------------------------------------------------


def _snapshot_payload() -> dict:
    return {
        "setup": "breakout",
        "min_rel_volume": 0.7,
        "updated_at": "2026-10-06T10:00:00+05:30",
        "items": [
            {
                "symbol": "AAA", "setup_id": "breakout",
                "trigger_level": 100.0, "invalidate_level": 90.0,
                "base_days": 60, "range_pct": 10.0, "confidence": 80.0,
                "status": "forming", "end_date": "2026-10-03", "fresh": False,
                "ltp": 101.0, "rel_volume": 1.2, "vol_adj": 1.5,
                "pct_to_trigger": 1.0, "state": "triggered",
            }
        ],
    }


def test_watch_returns_snapshot_without_arm_live(cp_client, monkeypatch):
    """A fresh snapshot is returned directly; arm/live are never called."""
    payload = _snapshot_payload()

    def _snap(setup, universe=None, timeframe="1D", max_age_seconds=90):
        assert setup == "breakout"
        return dict(payload)

    def _boom(*args, **kwargs):
        raise AssertionError("arm/live must not run on a snapshot hit")

    monkeypatch.setattr(watch_mod, "get_snapshot", _snap, raising=False)
    monkeypatch.setattr(watch_mod, "arm", _boom)
    monkeypatch.setattr(watch_mod, "live", _boom)

    resp = cp_client.get("/api/chart-patterns/watch?setup=breakout")
    assert resp.status_code == 200
    assert resp.json() == payload


def test_watch_falls_back_when_snapshot_missing(cp_client, monkeypatch):
    """``get_snapshot -> None`` runs the arm + live path with the old shape."""
    monkeypatch.setattr(
        watch_mod, "get_snapshot", lambda *a, **k: None, raising=False
    )
    rows = [{
        "symbol": "AAA", "setup_id": "breakout",
        "trigger_level": 100.0, "invalidate_level": 90.0,
        "base_days": 60, "range_pct": 10.0, "confidence": 80.0,
        "status": "forming", "end_date": "2026-10-03", "fresh": False,
    }]
    monkeypatch.setattr(watch_mod, "arm", lambda setup, **k: [dict(r) for r in rows])
    monkeypatch.setattr(
        watch_mod, "live",
        lambda rows, min_rel_volume=0.7: [
            dict(r, ltp=99.0, rel_volume=None, vol_adj=None,
                 pct_to_trigger=-1.0, state="armed") for r in rows
        ],
    )

    resp = cp_client.get("/api/chart-patterns/watch?setup=breakout")
    assert resp.status_code == 200
    body = resp.json()
    assert body["setup"] == "breakout"
    assert body["min_rel_volume"] == pytest.approx(0.7)
    assert body["updated_at"]
    assert len(body["items"]) == 1
    assert body["items"][0]["state"] == "armed"


def test_watch_falls_back_on_malformed_snapshot(cp_client, monkeypatch):
    """A non-payload dict (no ``items``) is ignored; the fallback runs."""
    monkeypatch.setattr(
        watch_mod, "get_snapshot", lambda *a, **k: {"stale": True}, raising=False
    )
    monkeypatch.setattr(watch_mod, "arm", lambda setup, **k: [])
    monkeypatch.setattr(watch_mod, "live", lambda rows, min_rel_volume=0.7: [])

    resp = cp_client.get("/api/chart-patterns/watch?setup=breakout")
    assert resp.status_code == 200
    assert resp.json()["items"] == []

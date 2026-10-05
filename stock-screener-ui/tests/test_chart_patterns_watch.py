"""Breakout Watch backend tests (``chart_patterns/watch.py`` + ``/watch`` endpoints).

Store-backed ``arm`` tests use the in-memory ``test_db_engine`` fixture —
no ``*.db`` files. ``live`` price/TV seams are monkeypatched (no network).
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from api.chart_patterns import router
from chart_patterns import store
from chart_patterns import watch as watch_mod


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


def test_registry_breakout_shape():
    setup = watch_mod.SETUPS["breakout"]
    assert setup == {
        "id": "breakout",
        "label": "Long-base breakout",
        "description": "Long tight base; trigger = box high, invalidate = box low",
        "source_pattern": "consolidation",
        "statuses": ["forming", "failed", "marginal"],
        "min_base_days": 60,
        "max_range_pct": 20.0,
        "trigger": "breakout_level",
        "invalidate": "base_low",
        "default_min_rel_volume": 1.5,
    }


def test_public_setups_hides_internals():
    payload = watch_mod.public_setups()
    assert payload == [
        {
            "id": "breakout",
            "label": "Long-base breakout",
            "description": "Long tight base; trigger = box high, invalidate = box low",
            "default_min_rel_volume": 1.5,
        }
    ]


# ---------------------------------------------------------------------------
# arm (store-backed)
# ---------------------------------------------------------------------------


def _hit(symbol: str, **overrides) -> dict:
    hit = {
        "symbol": symbol,
        "name": symbol,
        "timeframe": "1D",
        "pattern_id": "consolidation",
        "pattern_name": "Consolidation",
        "family": "continuation",
        "direction": "neutral",
        "status": "forming",
        "quality": "fair",
        "confidence": 60.0,
        "start_date": "2026-01-01",
        "end_date": "2026-06-01",
        "start_price": 100.0,
        "end_price": 102.0,
        "breakout_level": 105.0,
        "target": 110.0,
        "stop": 98.0,
        "rr": 2.0,
        "bars_ago": 0,
        "volume_confirmed": False,
        "base_days": 120,
        "range_pct": 10.0,
        "range_pos": 60.0,
        "trendlines": [
            [{"t": "2026-01-01", "price": 105.0}, {"t": "2026-06-01", "price": 105.0}],
            [{"t": "2026-01-01", "price": 95.0}, {"t": "2026-06-01", "price": 95.0}],
        ],
        "notes": "synthetic",
    }
    hit.update(overrides)
    return hit


@pytest.fixture
def cp_store(test_db_engine):
    factory = sessionmaker(autocommit=False, autoflush=False, bind=test_db_engine)
    store.set_session_factory(factory)
    try:
        yield factory
    finally:
        store.reset_session_factory()


def _seed(job_id: str = "cpj_watch", hits=()) -> None:
    store.save_job({"job_id": job_id, "universe": "nifty500", "timeframe": "1D", "status": "completed"})
    if hits:
        store.save_hits(job_id, list(hits))


def test_arm_empty_store_returns_empty(cp_store):
    assert watch_mod.arm("breakout") == []


def test_arm_unknown_setup_raises(cp_store):
    with pytest.raises(ValueError):
        watch_mod.arm("nope")


def test_arm_row_shape_and_levels(cp_store):
    _seed(hits=[_hit("AAA")])
    rows = watch_mod.arm("breakout")
    assert len(rows) == 1
    assert rows[0] == {
        "symbol": "AAA",
        "setup_id": "breakout",
        "trigger_level": pytest.approx(105.0),
        "invalidate_level": pytest.approx(95.0),
        "base_days": 120,
        "range_pct": pytest.approx(10.0),
        "confidence": pytest.approx(60.0),
        "status": "forming",
        "end_date": "2026-06-01",
        "fresh": False,
    }


def test_arm_falls_back_to_range_derived_low(cp_store):
    hit = _hit("AAA", trendlines=[])
    _seed(hits=[hit])
    rows = watch_mod.arm("breakout")
    assert len(rows) == 1
    assert rows[0]["invalidate_level"] == pytest.approx(105.0 * (1 - 10.0 / 100.0))


def test_arm_filters_status_base_days_and_range(cp_store):
    _seed(hits=[
        _hit("KEEP", status="forming", base_days=90, range_pct=12.0),
        # Stale ``confirmed`` (+18% above its box) -> still excluded.
        _hit("BROKE", status="confirmed", base_days=90, range_pct=12.0,
             breakout_level=100.0, end_price=118.0, range_pos=280.0,
             trendlines=[
                 [{"t": "2026-01-01", "price": 100.0}, {"t": "2026-06-01", "price": 100.0}],
                 [{"t": "2026-01-01", "price": 90.0}, {"t": "2026-06-01", "price": 90.0}],
             ]),
        _hit("BADSTATUS", status="cancelled", base_days=90, range_pct=12.0),
        _hit("SHORT", status="forming", base_days=30, range_pct=12.0),
        _hit("WIDE", status="forming", base_days=90, range_pct=25.0),
    ])
    rows = watch_mod.arm("breakout")
    # ``confirmed`` far above the box (stale breakout) -> not a candidate.
    assert [r["symbol"] for r in rows] == ["KEEP"]


def test_arm_includes_fresh_confirmed_but_not_stale(cp_store):
    """DEVX case: stored ``confirmed`` ~0.5% above its box is armed with
    ``fresh=True``; a stale ``confirmed`` ~18% above is excluded."""
    devx_top = [
        {"t": "2026-01-01", "price": 36.95},
        {"t": "2026-06-01", "price": 36.95},
    ]
    devx_low = [
        {"t": "2026-01-01", "price": 33.50},
        {"t": "2026-06-01", "price": 33.50},
    ]
    _seed(hits=[
        _hit("DEVX", status="confirmed", base_days=90, range_pct=10.3,
             breakout_level=36.95, end_price=37.15, range_pos=105.8,
             trendlines=[devx_top, devx_low]),
        _hit("STALE", status="confirmed", base_days=90, range_pct=10.0,
             breakout_level=100.0, end_price=118.0, range_pos=280.0,
             trendlines=[
                 [{"t": "2026-01-01", "price": 100.0}, {"t": "2026-06-01", "price": 100.0}],
                 [{"t": "2026-01-01", "price": 90.0}, {"t": "2026-06-01", "price": 90.0}],
             ]),
    ])
    rows = watch_mod.arm("breakout")
    assert [r["symbol"] for r in rows] == ["DEVX"]
    devx = rows[0]
    assert devx["fresh"] is True
    assert devx["trigger_level"] == pytest.approx(36.95)
    assert devx["status"] == "confirmed"


def test_arm_confirmed_without_range_pos_falls_back_to_end_price(cp_store):
    """No usable ``range_pos``: freshness comes from the stored close's gap
    to ``breakout_level`` (small gap armed, large gap excluded)."""
    _seed(hits=[
        _hit("FRESH", status="confirmed", base_days=90, range_pct=12.0,
             breakout_level=105.0, end_price=105.5, range_pos=None),
        _hit("STALE", status="confirmed", base_days=90, range_pct=12.0,
             breakout_level=105.0, end_price=125.0, range_pos=None),
    ])
    rows = watch_mod.arm("breakout")
    assert [r["symbol"] for r in rows] == ["FRESH"]
    assert rows[0]["fresh"] is True


def test_arm_respects_overrides(cp_store):
    _seed(hits=[_hit("AAA", base_days=90, range_pct=12.0)])
    assert watch_mod.arm("breakout", min_base_days=100) == []
    assert watch_mod.arm("breakout", max_range_pct=10.0) == []
    assert len(watch_mod.arm("breakout", min_base_days=60, max_range_pct=15.0)) == 1


def test_arm_dedupes_by_symbol_highest_confidence(cp_store):
    _seed(hits=[
        _hit("AAA", confidence=55.0, start_date="2026-01-01", breakout_level=105.0),
        _hit("AAA", confidence=80.0, start_date="2026-02-01", breakout_level=107.0),
        _hit("BBB", confidence=70.0, start_date="2026-01-01"),
    ])
    rows = watch_mod.arm("breakout")
    assert sorted(r["symbol"] for r in rows) == ["AAA", "BBB"]
    aaa = next(r for r in rows if r["symbol"] == "AAA")
    assert aaa["confidence"] == pytest.approx(80.0)
    assert aaa["trigger_level"] == pytest.approx(107.0)


def test_arm_symbol_and_timeframe_scope(cp_store):
    _seed(job_id="cpj_w1", hits=[_hit("AAA")])
    assert [r["symbol"] for r in watch_mod.arm("breakout", symbol="aaa")] == ["AAA"]
    assert watch_mod.arm("breakout", symbol="ZZZ") == []
    assert watch_mod.arm("breakout", timeframe="1W") == []


# ---------------------------------------------------------------------------
# live (mocked price + TV)
# ---------------------------------------------------------------------------


def _row(symbol: str, trigger: float = 105.0, low: float = 95.0, fresh: bool = False) -> dict:
    return {
        "symbol": symbol,
        "setup_id": "breakout",
        "trigger_level": trigger,
        "invalidate_level": low,
        "base_days": 120,
        "range_pct": 10.0,
        "confidence": 60.0,
        "status": "forming",
        "end_date": "2026-06-01",
        "fresh": fresh,
    }


@pytest.fixture
def mock_quotes(monkeypatch):
    """Seed LTP + TV rel-vol: ``{symbol: (ltp, rel_volume)}`` (None = missing)."""
    state: dict = {}

    def fake_ltp(symbols):
        return {s: px for s, (px, _rel) in state.items() if s in symbols and px is not None}

    def fake_tape(symbol, timeframe="1m"):
        return None  # missing stays missing

    def fake_tv(symbols):
        return {s: {"rel_volume": rel} for s, (_px, rel) in state.items() if s in symbols}

    monkeypatch.setattr(watch_mod, "_ltp_prices", fake_ltp)
    monkeypatch.setattr(watch_mod, "_tape_price", fake_tape)
    import chart_patterns.tv_prefilter as tv

    monkeypatch.setattr(tv, "fetch_tv_volume_metrics", fake_tv)
    return state


def test_live_triggered(mock_quotes):
    mock_quotes["AAA"] = (110.0, 2.0)
    (row,) = watch_mod.live([_row("AAA")])
    assert row["ltp"] == pytest.approx(110.0)
    assert row["rel_volume"] == pytest.approx(2.0)
    assert row["pct_to_trigger"] == pytest.approx(4.76, abs=0.01)
    assert row["state"] == "triggered"


def test_live_armed_below_trigger(mock_quotes):
    mock_quotes["AAA"] = (103.0, 2.5)
    (row,) = watch_mod.live([_row("AAA")])
    assert row["state"] == "armed"
    assert row["pct_to_trigger"] < 0


def test_live_armed_when_volume_light(mock_quotes):
    mock_quotes["AAA"] = (106.0, 1.0)
    (row,) = watch_mod.live([_row("AAA")])
    assert row["state"] == "armed"


def test_live_invalidated(mock_quotes):
    mock_quotes["AAA"] = (93.0, 0.8)
    (row,) = watch_mod.live([_row("AAA")])
    assert row["state"] == "invalidated"


def test_live_missing_price_stays_armed(mock_quotes):
    mock_quotes["AAA"] = (None, 2.0)
    (row,) = watch_mod.live([_row("AAA")])
    assert row["ltp"] is None
    assert row["pct_to_trigger"] is None
    assert row["state"] == "armed"


def test_tape_fallback_parallel_and_cached(monkeypatch):
    """Empty LTP falls back to one 1m tape fetch per missing symbol, fanned
    out over a bounded pool and memoised, so a repeat poll refetches nothing."""
    import threading
    import time

    import pandas as pd

    import chart_patterns.candles as candles
    import chart_patterns.tv_prefilter as tv

    watch_mod._TAPE_CACHE.clear()
    calls: list = []
    active = {"n": 0, "peak": 0}
    lock = threading.Lock()

    def fake_fetch(symbol, tf_id, **kwargs):
        with lock:
            calls.append(symbol)
            active["n"] += 1
            active["peak"] = max(active["peak"], active["n"])
        try:
            time.sleep(0.05)
        finally:
            with lock:
                active["n"] -= 1
        return pd.DataFrame({"close": [100.0, 101.5]})

    monkeypatch.setattr(candles, "fetch_for_timeframe", fake_fetch)
    monkeypatch.setattr(watch_mod, "_ltp_prices", lambda symbols: {})
    monkeypatch.setattr(
        tv, "fetch_tv_volume_metrics",
        lambda symbols: {s: {"rel_volume": 2.0} for s in symbols},
    )
    try:
        assert 4 <= watch_mod._TAPE_WORKERS <= 6  # bounded fan-out
        rows = [_row(s) for s in ("A1", "A2", "A3", "A4")]
        out = watch_mod.live(rows)
        assert [r["ltp"] for r in out] == pytest.approx([101.5] * 4)
        assert sorted(calls) == ["A1", "A2", "A3", "A4"]  # missing-only
        assert active["peak"] > 1  # genuinely parallel, not serial

        out2 = watch_mod.live(rows)
        assert [r["ltp"] for r in out2] == pytest.approx([101.5] * 4)
        assert len(calls) == 4  # second poll served from the TTL cache
    finally:
        watch_mod._TAPE_CACHE.clear()


def test_tape_fallback_total_failure_stays_armed(monkeypatch):
    """LTP empty + tape empty: rows stay ``armed`` with ``ltp=None``."""
    import chart_patterns.tv_prefilter as tv

    watch_mod._TAPE_CACHE.clear()
    monkeypatch.setattr(watch_mod, "_ltp_prices", lambda symbols: {})
    monkeypatch.setattr(watch_mod, "_tape_price", lambda symbol, timeframe="1m": None)
    monkeypatch.setattr(tv, "fetch_tv_volume_metrics", lambda symbols: {})
    try:
        (row,) = watch_mod.live([_row("AAA")])
        assert row["ltp"] is None
        assert row["state"] == "armed"
    finally:
        watch_mod._TAPE_CACHE.clear()


def test_ltp_skips_doomed_call_when_token_expired(monkeypatch):
    """A DB token older than its TTL skips the LTP HTTP call entirely."""
    from datetime import datetime, timedelta, timezone

    import db.models as models

    stale = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    monkeypatch.setattr(
        models, "get_shared_broker_token",
        lambda name: {"access_token": "OLD", "token_timestamp": stale},
    )
    assert watch_mod._upstox_token_expired() is True

    import requests

    def boom(*args, **kwargs):
        raise AssertionError("LTP must not be called with an expired token")

    monkeypatch.setattr(requests, "get", boom)
    assert watch_mod._ltp_prices(["AAA"]) == {}


def test_ltp_401_refreshes_token_and_retries(monkeypatch):
    """HTTP 401 triggers one refresh attempt; the failed batch is retried
    with the new token instead of falling back to per-symbol tape fetches."""
    import sys
    import types
    from datetime import datetime, timezone

    import db.models as models

    fresh_ts = datetime.now(timezone.utc).isoformat()
    monkeypatch.setattr(
        models, "get_shared_broker_token",
        lambda name: {
            "access_token": "OLD",
            "token_timestamp": fresh_ts,
            "refresh_token": "RT",
        },
    )
    assert watch_mod._upstox_token_expired() is False
    monkeypatch.setattr(
        watch_mod, "_instrument_keys", lambda symbols: {s: f"KEY:{s}" for s in symbols}
    )

    fake_mod = types.ModuleType("upstox_auth_refresh")
    seen: dict = {}

    def fake_refresh(refresh_token=None):
        seen["refresh_token"] = refresh_token
        return "NEW"

    fake_mod.refresh_access_token = fake_refresh
    monkeypatch.setitem(sys.modules, "upstox_auth_refresh", fake_mod)

    import requests

    used: list = []

    class _Resp:
        def __init__(self, status, payload=None):
            self.status_code = status
            self._payload = payload or {}

        def json(self):
            return {"data": self._payload}

    def fake_get(url, params=None, headers=None, timeout=None):
        used.append(headers["Authorization"])
        if headers["Authorization"] == "Bearer OLD":
            return _Resp(401)
        return _Resp(200, {"KEY:AAA": {"last_price": 111.0}})

    monkeypatch.setattr(requests, "get", fake_get)
    assert watch_mod._ltp_prices(["AAA"]) == {"AAA": 111.0}
    assert used == ["Bearer OLD", "Bearer NEW"]
    assert seen["refresh_token"] == "RT"


def test_try_refresh_returns_none_without_helper(monkeypatch):
    """No refresh module importable and no stored refresh token → ``None``,
    never raises (callers fall back to the tape)."""
    import sys

    import db.models as models

    monkeypatch.setattr(models, "get_shared_broker_token", lambda name: None)
    monkeypatch.delitem(sys.modules, "upstox_auth_refresh", raising=False)
    monkeypatch.delitem(sys.modules, "upstox_auth", raising=False)
    assert watch_mod._try_refresh_upstox_token() is None


def test_live_honours_min_rel_volume(mock_quotes):
    mock_quotes["AAA"] = (110.0, 2.0)
    (row,) = watch_mod.live([_row("AAA")], min_rel_volume=3.0)
    assert row["state"] == "armed"


def test_live_fresh_cross_triggered(mock_quotes):
    """A fresh-cross row (armed from a fresh ``confirmed`` break) with the
    live price above the trigger and confirming volume is ``triggered`` —
    even though the last completed bar was already above the box."""
    mock_quotes["AAA"] = (37.40, 2.0)
    (row,) = watch_mod.live([_row("AAA", trigger=36.95, low=33.50, fresh=True)])
    assert row["ltp"] == pytest.approx(37.40)
    assert row["state"] == "triggered"


def test_live_fresh_cross_unknown_volume_triggered(mock_quotes):
    """Fresh cross holding above the trigger with no volume measurement is
    ``triggered``; the same bar on a non-fresh row stays ``armed``."""
    mock_quotes["AAA"] = (110.0, None)
    mock_quotes["BBB"] = (110.0, None)
    fresh_row, plain_row = watch_mod.live([
        _row("AAA", fresh=True),
        _row("BBB", fresh=False),
    ])
    assert fresh_row["state"] == "triggered"
    assert plain_row["state"] == "armed"


# ---------------------------------------------------------------------------
# Endpoints (contract)
# ---------------------------------------------------------------------------


@pytest.fixture
def cp_client(test_db_engine, mock_quotes):
    factory = sessionmaker(autocommit=False, autoflush=False, bind=test_db_engine)
    store.set_session_factory(factory)
    app = FastAPI()
    app.include_router(router)
    try:
        with TestClient(app) as client:
            yield client
    finally:
        store.reset_session_factory()


def test_watch_setups_contract(cp_client):
    resp = cp_client.get("/api/chart-patterns/watch/setups")
    assert resp.status_code == 200
    assert resp.json() == {
        "setups": [
            {
                "id": "breakout",
                "label": "Long-base breakout",
                "description": "Long tight base; trigger = box high, invalidate = box low",
                "default_min_rel_volume": 1.5,
            }
        ]
    }


def test_watch_contract(cp_client, mock_quotes):
    _seed(hits=[_hit("AAA")])
    mock_quotes["AAA"] = (110.0, 2.0)
    resp = cp_client.get("/api/chart-patterns/watch?setup=breakout")
    assert resp.status_code == 200
    data = resp.json()
    assert data["setup"] == "breakout"
    assert data["min_rel_volume"] == pytest.approx(1.5)
    assert data["updated_at"]
    assert len(data["items"]) == 1
    item = data["items"][0]
    assert set(item) == {
        "symbol", "setup_id", "trigger_level", "invalidate_level", "base_days",
        "range_pct", "confidence", "status", "end_date", "fresh",
        "ltp", "rel_volume", "pct_to_trigger", "state",
    }
    assert item["state"] == "triggered"


def test_watch_unknown_setup_404(cp_client):
    resp = cp_client.get("/api/chart-patterns/watch?setup=nope")
    assert resp.status_code == 404


def test_watch_empty_store(cp_client):
    resp = cp_client.get("/api/chart-patterns/watch?setup=breakout")
    assert resp.status_code == 200
    assert resp.json()["items"] == []

"""Tests for every registered replay engine and the generic endpoint.

Offline: swing engines patch ``load_daily_bars``; intraday/tick engines are
driven with synthetic in-memory bars/ticks; the generic endpoint is exercised
via TestClient with the NQ loader patched.
"""
from datetime import datetime
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.poc_nq as poc_nq
from config import IST
from tests.test_poc_nq import BASIS, _make_ticks
from tests.test_week52_replay_engine import _make_daily_df
from trading.replay import registry
from trading.replay.contract import ReplayContext

EXPECTED_IDS = [
    "vwap-orb", "smc-ifvg", "week52-chaser", "smc-chop",
    "orb", "sr-breakout", "ema-cross", "smc",
    "52w-target", "blind-52w", "short-52w-failed", "adx-trend", "volume-surge",
]

SWING_IDS = ["52w-target", "blind-52w", "short-52w-failed", "adx-trend", "volume-surge"]
INTRADAY_IDS = ["orb", "sr-breakout", "ema-cross", "smc"]

CANONICAL = {"time", "exit_time", "side", "kind", "entry", "sl", "tp",
             "exit", "result", "pnl", "rr", "meta"}

PATCH_WEEK52 = "trading.replay.engines.week52.fetch_candles"
PATCH_SWING_LOAD = "trading.replay.engines.signal_swing.load_daily_bars"
PATCH_NQ_TICKS = "scripts.nq_ticks.fetch_nq_ticks"
PATCH_NSE_1M = "trading.replay.engines.signal_intraday.load_nse_1m"
PATCH_PREV_DAILY = "trading.replay.engines.signal_intraday.load_prev_daily_bar"


@pytest.fixture(autouse=True)
def _clear_cache():
    poc_nq._cache.clear()
    yield
    poc_nq._cache.clear()


def _assert_canonical(trades):
    for tr in trades:
        assert CANONICAL <= set(tr), tr
        assert isinstance(tr["time"], int)
        assert isinstance(tr["exit_time"], int)
        assert tr["side"] in ("LONG", "SHORT")
        assert isinstance(tr["kind"], str) and tr["kind"]
        assert isinstance(tr["entry"], float)
        assert isinstance(tr["sl"], float)
        assert tr["tp"] is None or isinstance(tr["tp"], float)
        assert isinstance(tr["exit"], float)
        assert isinstance(tr["result"], str) and tr["result"]
        assert isinstance(tr["pnl"], float)
        assert isinstance(tr["rr"], float)
        assert isinstance(tr["meta"], dict)
        assert tr["time"] <= tr["exit_time"]


def _trend_bars(n=400, start=100.0, step=0.5, vol=100000, surge_at=None, surge_mult=4):
    """Steady uptrend daily bars; optional volume-spike bar."""
    base = int(datetime(2024, 1, 1, tzinfo=IST).timestamp())
    bars = []
    for i in range(n):
        close = start + i * step
        is_surge = surge_at is not None and i == surge_at
        bars.append({
            "time": base + i * 86400,
            "open": close - step,
            "high": close + 0.2 if is_surge else close + 1.0,
            "low": close - 1.0,
            "close": close,
            "volume": vol * surge_mult if is_surge else vol,
        })
    return bars


def _params(engine, overrides=None):
    merged = {p.name: p.default for p in engine.params}
    merged.update(overrides or {})
    return merged


def _intraday_bars(n=120, or_minutes=45):
    base = int(datetime(2026, 1, 5, 9, 15, tzinfo=IST).timestamp())
    bars = []
    for m in range(n):
        if m < or_minutes:
            close = 100.0 + 0.01 * m
        elif m == or_minutes:
            close = 102.0
        else:
            close = 102.0 + 0.2 * (m - or_minutes)
        bars.append({
            "time": base + m * 60,
            "open": close - 0.05, "high": close + 0.2,
            "low": close - 0.3, "close": close, "volume": 1000,
        })
    return bars


def _ticks_from_bars(bars):
    return [{"timestamp": b["time"] * 1000, "bidPrice": b["close"],
             "askPrice": b["close"] + 0.25, "bidVolume": 1, "askVolume": 1}
            for b in bars]


class _FakeRequest:
    def __init__(self, params=None):
        self.query_params = params or {}


# ---------------- registry ----------------

class TestRegistryAllEngines:

    def test_every_id_resolves_and_lists(self):
        listed = {s["id"] for s in registry.list_strategies()}
        for sid in EXPECTED_IDS:
            engine = registry.get(sid)
            assert engine is not None, f"{sid} not registered"
            assert sid in listed
            assert engine.label
            assert engine.params

    def test_param_specs_serialize(self):
        for sid in EXPECTED_IDS:
            engine = registry.get(sid)
            for p in engine.params:
                d = p.to_dict()
                assert {"name", "label", "type", "default"} <= set(d)


# ---------------- swing engines ----------------

class TestSwingEngines:

    def test_week52_chaser_produces_ordered_trade(self):
        engine = registry.get("week52-chaser")
        with patch(PATCH_WEEK52, return_value=_make_daily_df()):
            ctx = engine.load("2025-02-04", _params(engine))
        result = engine.run(ctx)
        assert len(result.trades) >= 1
        _assert_canonical(result.trades)
        times = [t["time"] for t in result.trades]
        assert times == sorted(times)
        assert result.extras["bars"] is ctx.bars
        assert result.kpis["trades"] == len(result.trades)

    def test_adx_trend_or_volume_surge_produce_trade(self):
        bars = _trend_bars(surge_at=350)
        produced = []
        for sid in ("adx-trend", "volume-surge"):
            engine = registry.get(sid)
            ctx = ReplayContext(date="2025-02-04", symbol="NETWEB", params=_params(engine),
                                ticks=[], bars=bars)
            result = engine.run(ctx)
            if result.trades:
                produced.append(sid)
                _assert_canonical(result.trades)
                times = [t["time"] for t in result.trades]
                assert times == sorted(times)
        assert produced, "neither adx-trend nor volume-surge produced a trade"

    def test_all_swing_engines_run_without_exception(self):
        bars = _trend_bars(surge_at=350)
        for sid in SWING_IDS:
            engine = registry.get(sid)
            with patch(PATCH_SWING_LOAD, return_value=bars):
                ctx = engine.load("2025-02-04", _params(engine))
            result = engine.run(ctx)
            assert isinstance(result.trades, list)
            _assert_canonical(result.trades)
            assert result.extras["bars"] is ctx.bars


# ---------------- intraday engines ----------------

class TestIntradayEngines:

    def test_all_intraday_engines_run_without_exception(self):
        bars = _intraday_bars()
        ticks = _ticks_from_bars(bars)
        for sid in INTRADAY_IDS:
            engine = registry.get(sid)
            ctx = ReplayContext(date="2026-01-05", symbol="NQ=F", params=_params(engine),
                                ticks=ticks, bars=bars)
            result = engine.run(ctx)
            assert isinstance(result.trades, list)
            _assert_canonical(result.trades)

    def test_orb_produces_canonical_trade(self):
        engine = registry.get("orb")
        bars = _intraday_bars()
        ctx = ReplayContext(date="2026-01-05", symbol="NQ=F", params=_params(engine),
                            ticks=_ticks_from_bars(bars), bars=bars)
        result = engine.run(ctx)
        assert len(result.trades) >= 1
        _assert_canonical(result.trades)
        assert result.trades[0]["side"] == "LONG"

    def test_intraday_engine_load_hook(self):
        # NSE-driven intraday strategies own a load hook; smc stays NQ-loaded.
        for sid in ("orb", "sr-breakout", "ema-cross"):
            assert callable(getattr(registry.get(sid), "load", None)), sid
        assert getattr(registry.get("smc"), "load", None) is None


# ---------------- tick engine ----------------

class TestSmcChopEngine:

    def test_runs_over_ticks_without_exception(self):
        bars = _intraday_bars()
        ticks = _ticks_from_bars(bars)
        engine = registry.get("smc-chop")
        result = engine.run(ReplayContext(date="2026-01-05", symbol="NQ=F",
                                          params=_params(engine), ticks=ticks, bars=bars))
        assert isinstance(result.trades, list)
        _assert_canonical(result.trades)


# ---------------- generic endpoint ----------------

class TestGenericEndpoint:

    def _client(self):
        app = FastAPI()
        app.include_router(poc_nq.router)
        return TestClient(app)

    def test_intraday_id_envelope(self):
        bars = _intraday_bars()
        with patch(PATCH_NSE_1M, return_value=bars), \
                patch(PATCH_PREV_DAILY, return_value=[]):
            res = self._client().get("/api/poc/replay/orb?date=2026-01-05&or_minutes=45")
        assert res.status_code == 200
        data = res.json()
        assert "error" not in data
        assert data["strategy_id"] == "orb"
        for key in ("label", "date", "params", "count", "trades", "zones",
                    "trends", "levels", "kpis", "bars"):
            assert key in data, f"missing {key}"
        assert data["count"] == len(data["trades"])
        _assert_canonical(data["trades"])

    def test_swing_id_envelope(self):
        bars = _trend_bars(surge_at=350)
        with patch(PATCH_SWING_LOAD, return_value=bars):
            res = self._client().get("/api/poc/replay/adx-trend?date=2025-02-04&symbol=NETWEB")
        assert res.status_code == 200
        data = res.json()
        assert "error" not in data
        assert data["strategy_id"] == "adx-trend"
        assert data["symbol"] == "NETWEB"
        assert data["params"]["symbol"] == "NETWEB"
        for key in ("label", "date", "params", "count", "trades", "zones",
                    "trends", "levels", "kpis", "bars"):
            assert key in data, f"missing {key}"
        _assert_canonical(data["trades"])

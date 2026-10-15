"""Tests for NSE 1m intraday replay engines (ORB / S/R breakout / EMA cross).

Offline: the engine's module-level ``load_nse_1m`` / ``load_prev_daily_bar``
symbols are patched, exactly like the other replay tests patch their loaders.
The generic endpoint is exercised via TestClient with the same patches.
"""
from datetime import datetime
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.poc_nq as poc_nq
from config import IST
from trading.replay import registry
from trading.replay.engines.signal_intraday import NseIntradaySignalReplay

NSE_IDS = ["orb", "sr-breakout", "ema-cross"]

CANONICAL = {"time", "exit_time", "side", "kind", "entry", "sl", "tp",
             "exit", "result", "pnl", "rr", "meta"}

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


def _nse_bars(n=400, or_minutes=45):
    """Synthetic 1m session: a wide (V-shaped) opening range, then a breakout.

    The opening triangle keeps the OR range >0.5% while letting fast/slow EMAs
    converge, so ORB, S/R breakout and EMA cross all trigger on the jump.
    """
    base = int(datetime(2026, 1, 5, 9, 15, tzinfo=IST).timestamp())
    half = max(1, or_minutes // 2)
    bars = []
    for m in range(n):
        if m < or_minutes:
            close = 100.0 + 0.5 * (m / half) if m <= half else 100.5 - 0.5 * ((m - half) / (or_minutes - half))
        elif m == or_minutes:
            close = 101.2
        else:
            close = 101.2 + 0.03 * (m - or_minutes)
        bars.append({
            "time": base + m * 60,
            "open": close - 0.05,
            "high": close + 0.2,
            "low": close - 0.3,
            "close": close,
            "volume": 1000,
        })
    return bars


def _prev_daily_bar():
    # prior session -> classic pivots with R1 ~ 99.9, just below the breakout.
    base = int(datetime(2026, 1, 2, 9, 15, tzinfo=IST).timestamp())
    return [{"time": base, "open": 99.2, "high": 99.8, "low": 98.0,
             "close": 99.0, "volume": 100000}]


def _params(engine, overrides=None):
    merged = {p.name: p.default for p in engine.params}
    merged.update(overrides or {})
    return merged


class TestNseIntradayEngines:

    def test_ids_use_nse_engine_and_declare_symbol(self):
        for sid in NSE_IDS:
            engine = registry.get(sid)
            assert isinstance(engine, NseIntradaySignalReplay), sid
            spec = {p.name: p for p in engine.params}
            assert "symbol" in spec
            assert spec["symbol"].type == "text"
            assert spec["symbol"].default == "RELIANCE"

    @pytest.mark.parametrize("sid", NSE_IDS)
    def test_run_produces_canonical_trades(self, sid):
        engine = registry.get(sid)
        bars = _nse_bars()
        with patch(PATCH_NSE_1M, return_value=bars), \
                patch(PATCH_PREV_DAILY, return_value=_prev_daily_bar()):
            ctx = engine.load("2026-01-05", _params(engine, {"symbol": "reliance"}))
        result = engine.run(ctx)

        assert isinstance(result.trades, list)
        assert len(result.trades) >= 1, f"{sid} produced no trade"
        _assert_canonical(result.trades)
        times = [t["time"] for t in result.trades]
        assert times == sorted(times)
        assert result.extras["bars"] == bars
        assert result.extras["bars"] is ctx.bars

    def test_load_sets_symbol_and_bars(self):
        engine = registry.get("orb")
        bars = _nse_bars()
        with patch(PATCH_NSE_1M, return_value=bars) as m_load, \
                patch(PATCH_PREV_DAILY, return_value=_prev_daily_bar()):
            ctx = engine.load("2026-01-05", _params(engine, {"symbol": "infy"}))
        assert ctx.symbol == "INFY"
        assert ctx.bars == bars
        assert ctx.hist_bars == _prev_daily_bar()
        m_load.assert_called_once_with("INFY", "2026-01-05")

    def test_load_defaults_symbol_and_handles_no_prior_bar(self):
        engine = registry.get("orb")
        with patch(PATCH_NSE_1M, return_value=[]), \
                patch(PATCH_PREV_DAILY, return_value=[]):
            ctx = engine.load("2026-01-05", _params(engine))
        assert ctx.symbol == "RELIANCE"
        assert ctx.bars == []
        assert ctx.hist_bars is None


class TestNseGenericEndpoint:

    def _client(self):
        app = FastAPI()
        app.include_router(poc_nq.router)
        return TestClient(app)

    def test_orb_endpoint_uses_engine_load(self):
        bars = _nse_bars()
        with patch(PATCH_NSE_1M, return_value=bars) as m_load, \
                patch(PATCH_PREV_DAILY, return_value=_prev_daily_bar()):
            res = self._client().get(
                "/api/poc/replay/orb?date=2026-01-05&symbol=INFY&or_minutes=45")
        assert res.status_code == 200
        data = res.json()
        assert "error" not in data
        assert data["strategy_id"] == "orb"
        for key in ("strategy_id", "trades", "bars"):
            assert key in data, f"missing {key}"
        assert data["symbol"] == "INFY"
        assert data["params"]["symbol"] == "INFY"
        assert data["count"] == len(data["trades"])
        assert data["bars"] == bars
        _assert_canonical(data["trades"])
        m_load.assert_called_once_with("INFY", "2026-01-05")

"""Tests for the replay strategy registry (trading/replay) and generic endpoint.

Offline: all data-layer access is monkeypatched exactly like tests/test_poc_nq.py.
"""

import pytest

import api.poc_nq as poc_nq
from api.poc_nq import get_replay, get_tick_replay
from scripts.smc_tick_eval import build_1m_bars as real_build_1m_bars
from tests.test_poc_nq import BASIS, _make_ticks
from trading.replay import registry
from trading.replay.contract import ReplayContext
from trading.replay.engines.vwap_orb import VwapOrbReplay


class _FakeRequest:
    """Minimal Request stand-in exposing ``query_params`` as a plain dict."""

    def __init__(self, params=None):
        self.query_params = params or {}


@pytest.fixture(autouse=True)
def _clear_cache():
    poc_nq._cache.clear()
    yield
    poc_nq._cache.clear()


# ---------------- registry ----------------

class TestRegistry:

    def test_builtin_strategies_registered(self):
        ids = {s["id"] for s in registry.list_strategies()}
        assert {"vwap-orb", "smc-ifvg"} <= ids

    def test_get_returns_engine(self):
        assert registry.get("vwap-orb").label == "VWAP + ORB"
        assert registry.get("smc-ifvg").label == "SMC iFVG"
        assert registry.get("does-not-exist") is None

    def test_duplicate_registration_raises(self):
        with pytest.raises(ValueError):
            registry.register(VwapOrbReplay())

    def test_list_strategies_returns_params(self):
        by_id = {s["id"]: s for s in registry.list_strategies()}
        vwap = by_id["vwap-orb"]
        names = {p["name"] for p in vwap["params"]}
        assert {"secs", "orb", "hist"} <= names
        for p in vwap["params"]:
            assert set(("name", "label", "type", "default")) <= set(p)
        smc = by_id["smc-ifvg"]
        assert {p["name"] for p in smc["params"]} == {"entries", "flip", "from_ist", "to_ist"}


# ---------------- strategies listing endpoint ----------------


class TestStrategiesEndpoint:

    def _client(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        app = FastAPI()
        app.include_router(poc_nq.router)
        return TestClient(app)

    def test_lists_known_strategies_with_params(self):
        res = self._client().get("/api/poc/replay/strategies")
        assert res.status_code == 200
        assert "strategies" in res.json()
        by_id = {s["id"]: s for s in res.json()["strategies"]}
        assert {"vwap-orb", "smc-ifvg"} <= set(by_id)
        for strategy in by_id.values():
            for p in strategy["params"]:
                assert {"name", "type", "default"} <= set(p)

    def test_not_captured_by_strategy_id_route(self):
        res = self._client().get("/api/poc/replay/strategies")
        data = res.json()
        assert "strategies" in data
        assert "strategy_id" not in data


# ---------------- generic endpoint ----------------

class TestGenericEndpoint:

    def test_unknown_strategy_returns_error_envelope(self):
        res = get_replay("nope", _FakeRequest())
        assert "error" in res
        assert "unknown strategy: nope" in res["error"]

    def test_vwap_orb_envelope_shape(self):
        ticks = _make_ticks(20)
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr("scripts.nq_ticks.fetch_nq_ticks", lambda date: (ticks, BASIS))
            res = get_replay("vwap-orb", _FakeRequest({"date": "2026-01-05", "secs": "2", "orb": "15", "hist": "0"}))
        assert "error" not in res
        assert res["strategy_id"] == "vwap-orb"
        assert res["label"] == "VWAP + ORB"
        for key in ("date", "params", "count", "trades", "zones", "trends", "levels", "kpis"):
            assert key in res, f"missing {key}"
        assert res["count"] == len(res["trades"])
        assert res["params"]["secs"] == 2
        assert res["params"]["orb"] == 15

    def test_param_clamping_and_unknown_keys_ignored(self):
        ticks = _make_ticks(20)
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr("scripts.nq_ticks.fetch_nq_ticks", lambda date: (ticks, BASIS))
            res = get_replay("vwap-orb", _FakeRequest({
                "date": "2026-01-05", "orb": "999", "secs": "0", "hist": "0", "bogus": "1",
            }))
        assert res["params"]["orb"] == 120  # clamped to max
        assert res["params"]["secs"] == 1   # clamped to min
        assert "bogus" not in res["params"]

    def test_missing_date_returns_error_envelope(self):
        res = get_replay("vwap-orb", _FakeRequest({"secs": "2"}))
        assert "error" in res
        assert res["trades"] == []


# ---------------- legacy adapter == engine ----------------

class TestAdapterMatchesEngine:

    def _ctx(self, ticks, date="2026-01-05"):
        return ReplayContext(
            date=date, symbol="NQ=F", params={"secs": 2, "orb": 15, "hist": 0},
            ticks=sorted(ticks, key=lambda t: t["timestamp"]),
            bars=real_build_1m_bars(ticks), hist_bars=None, basis=BASIS["median"],
        )

    def test_tick_replay_matches_vwap_orb_engine(self):
        ticks = _make_ticks(20)
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr("scripts.nq_ticks.fetch_nq_ticks", lambda date: (ticks, BASIS))
            adapter = get_tick_replay(date="2026-01-05", secs=2, orb=15, hist=0)
            direct = registry.get("vwap-orb").run(self._ctx(ticks))
        assert "error" not in adapter
        assert adapter["trades"] == direct.trades
        # legacy adapter mirrors engine levels through or_high/or_low (no `levels` key)
        assert adapter["or_high"] == direct.extras["or_high"] == direct.levels[0]
        assert adapter["or_low"] == direct.extras["or_low"] == direct.levels[1]

    def test_smc_adapter_matches_engine(self):
        ticks = _make_ticks(20)
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr("scripts.nq_ticks.fetch_nq_ticks", lambda date: (ticks, BASIS))
            adapter = poc_nq.get_smc_ifvg(date="2026-01-05", from_ist=None, to_ist=None,
                                         entries="both", flip=None)
            direct = registry.get("smc-ifvg").run(ReplayContext(
                date="2026-01-05", symbol="NQ=F",
                params={"entries": "both", "flip": None, "from_ist": None, "to_ist": None},
                ticks=sorted(ticks, key=lambda t: t["timestamp"]),
                bars=real_build_1m_bars(ticks), hist_bars=None, basis=BASIS["median"],
            ))
        assert "error" not in adapter
        assert adapter["trades"] == direct.trades

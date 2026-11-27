"""Dashboard-engine integration for ``GET /api/options/analytics/{symbol}``.

The P2 engines (positioning / dealer / liquidity / RND / RV) are optional and
mocked through ``sys.modules``: these tests pin that their blocks appear per
expiry, that nulls survive an absent or broken engine, that a bad RV read never
turns the ladder into a 500, and that the existing cache/rate-limit contract is
untouched.
"""

import asyncio
import sys
import threading
import time
import types
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api import options as opts  # noqa: E402
from api import options_analytics as oa  # noqa: E402
from api import options_underlying as ou  # noqa: E402

SPOT = 25_000.0
DATES = ["2026-11-17", "2026-11-24", "2026-12-01"]
ENGINE_MODULES = (
    "api.options_positioning",
    "api.options_dealer",
    "api.options_liquidity",
    "api.options_rnd",
    "api.options_rv",
)


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    ou._cache.clear()
    ou._locks.clear()
    oa._rv_cache.clear()
    for name in ENGINE_MODULES:
        monkeypatch.delitem(sys.modules, name, raising=False)
    yield
    ou._cache.clear()
    ou._locks.clear()
    oa._rv_cache.clear()


@pytest.fixture
def client(monkeypatch):
    app = FastAPI()
    app.include_router(oa.router)

    async def session_now():
        return "open"

    monkeypatch.setattr(oa, "_session_state_now", session_now)
    return TestClient(app)


def _install(monkeypatch, module_name, **funcs):
    module = types.ModuleType(module_name)
    for name, func in funcs.items():
        setattr(module, name, func)
    monkeypatch.setitem(sys.modules, module_name, module)
    return module


def _leg(iv=16.0, delta=0.4, oi=1_000, gamma=0.01):
    return {
        "market_data": {"ltp": 100.0, "oi": oi, "volume": 50, "prev_oi": 900},
        "option_greeks": {"iv": iv, "delta": delta, "gamma": gamma},
        "iv_valid": True,
    }


def _chain():
    return [
        {"strike": 24_900.0, "ce": None, "pe": _leg(17.0, -0.45)},
        {"strike": 25_100.0, "ce": _leg(16.0, 0.45), "pe": None},
    ]


def _underlying():
    return {
        "symbol": "NIFTY",
        "fno": True,
        "spot": SPOT,
        "quotes_live": True,
        "expiries": [
            {"date": date, "dte_days": i + 1} for i, date in enumerate(DATES)
        ],
    }


@pytest.fixture
def chain(monkeypatch):
    state = {"calls": [], "thin": False, "degraded": False, "quotes_live": True}

    async def underlying(symbol):
        data = _underlying()
        data["quotes_live"] = state["quotes_live"]
        data["market_state"] = "open" if state["quotes_live"] else "closed"
        return data

    async def build(symbol, expiry, session_state):
        state["calls"].append(expiry)
        return {
            "status": "ok",
            "expiry": expiry,
            "spot": SPOT,
            "chain": _chain(),
            "levels": {
                "step": 100.0,
                "thin": state["thin"],
                "gex": {"degraded": state["degraded"]},
            },
            "market_state": "open" if state["quotes_live"] else "closed",
            "quotes_live": state["quotes_live"],
            "session_date": "2026-11-16",
            "data_as_of": "2026-11-16T10:30:00+05:30",
        }

    monkeypatch.setattr(oa, "_underlying_payload", underlying)
    monkeypatch.setattr(opts, "_build_chain_response", build)
    return state


def _install_chain_engines(monkeypatch):
    _install(monkeypatch, "api.options_positioning",
             positioning_block=lambda rows, spot: {"pcr": 1.0})
    _install(monkeypatch, "api.options_dealer",
             dealer_block=lambda rows, spot, dte_years: {"gex": 1.0})
    _install(monkeypatch, "api.options_liquidity",
             liquidity_block=lambda rows: {"volume": 10})
    _install(monkeypatch, "api.options_rnd",
             risk_neutral_density=lambda points, spot, dte: {"density": []})


class TestBlocksPresent:
    def test_blocks_and_rv_are_typed_and_json_safe(self, client, chain, monkeypatch):
        seen = {}

        def positioning(rows, spot):
            seen.setdefault("positioning", (rows, spot))
            return {"pcr": 1.2, "bad": float("nan")}

        def dealer(rows, spot, dte_years):
            seen.setdefault("dealer", (rows, spot, dte_years))
            return {"gex": 1.0, "inf": float("inf")}

        def liquidity(rows):
            seen.setdefault("liquidity", (rows,))
            return {"volume": 10, "nested": [1.0, float("nan")]}

        def rnd(points, spot, dte):
            seen.setdefault("rnd", (points, spot, dte))
            return {"density": [{"k": 100.0, "q": 0.5}]}

        _install(monkeypatch, "api.options_positioning", positioning_block=positioning)
        _install(monkeypatch, "api.options_dealer", dealer_block=dealer)
        _install(monkeypatch, "api.options_liquidity", liquidity_block=liquidity)
        _install(monkeypatch, "api.options_rnd", risk_neutral_density=rnd)
        _install(monkeypatch, "api.options_rv",
                 realized_vol_cone=lambda symbol: {"cone": [[1, 12.0]], "bad": float("inf")},
                 iv_vs_rv=lambda expiries, cone: {"rows": [1]})

        response = client.get("/api/options/analytics/NIFTY")
        assert response.status_code == 200
        body = response.json()
        entry = body["expiries"][0]

        assert entry["positioning"] == {"pcr": 1.2, "bad": None}
        assert entry["dealer"] == {"gex": 1.0, "inf": None}
        assert entry["liquidity"] == {"volume": 10, "nested": [1.0, None]}
        assert entry["rnd"] == {"density": [{"k": 100.0, "q": 0.5}]}
        assert body["rv"] == {
            "cone": {"cone": [[1, 12.0]], "bad": None},
            "ivVsRv": {"rows": [1]},
        }
        assert "NaN" not in response.text and "Infinity" not in response.text
        assert "rv_unavailable" not in body["warnings"]

        # Engines see the chain already fetched, spot, DTE and the OTM points.
        assert len(seen["positioning"][0]) == 2  # raw chain rows
        assert seen["positioning"][1] == SPOT
        assert seen["dealer"][2] == pytest.approx(1 / 365)
        assert seen["rnd"][1] == SPOT
        assert seen["rnd"][2] == 1  # dte_days
        # RND gets the same raw chain rows as the other engines, so it can use
        # traded LTP first — not the OTM IvPoint records (no `ce`/`pe`/`market_data`).
        assert seen["rnd"][0] and {"strike", "ce", "pe"} <= set(seen["rnd"][0][0])
        ce_row = next(row for row in seen["rnd"][0] if row.get("ce"))
        assert "market_data" in ce_row["ce"]  # traded LTP is available to RND
        assert "side" not in seen["rnd"][0][0]

    def test_all_expiries_get_their_own_blocks(self, client, chain, monkeypatch):
        _install_chain_engines(monkeypatch)
        _install(monkeypatch, "api.options_rv",
                 realized_vol_cone=lambda symbol: {"cone": []},
                 iv_vs_rv=lambda expiries, cone: {"n": len(expiries)})

        body = client.get("/api/options/analytics/NIFTY?expiries=3").json()
        assert len(body["expiries"]) == 3
        for entry in body["expiries"]:
            assert entry["positioning"] == {"pcr": 1.0}
            assert entry["dealer"] == {"gex": 1.0}
            assert entry["liquidity"] == {"volume": 10}
            assert entry["rnd"] == {"density": []}
        assert body["rv"]["ivVsRv"]["n"] == 3

    def test_rnd_smile_fallback_warning_is_surfaced(self, client, chain, monkeypatch):
        _install(monkeypatch, "api.options_positioning",
                 positioning_block=lambda rows, spot: {})
        _install(monkeypatch, "api.options_dealer",
                 dealer_block=lambda rows, spot, dte_years: {})
        _install(monkeypatch, "api.options_liquidity", liquidity_block=lambda rows: {})
        _install(monkeypatch, "api.options_rnd", risk_neutral_density=lambda rows, spot, dte: {
            "density": [],
            "warnings": ["insufficient_prices", oa.RND_SMILE_FALLBACK_WARNING],
            "forward": None,
        })
        _install(monkeypatch, "api.options_rv",
                 realized_vol_cone=lambda symbol: {"cone": []},
                 iv_vs_rv=lambda expiries, cone: {})

        body = client.get("/api/options/analytics/NIFTY").json()
        rnd = body["expiries"][0]["rnd"]
        assert rnd["warnings"] == ["insufficient_prices", oa.RND_SMILE_FALLBACK_WARNING]
        assert rnd["forward"] is None  # engine metadata is preserved verbatim
        assert body["warnings"].count(oa.RND_SMILE_FALLBACK_WARNING) == 1


class TestAbsentAndBrokenEngines:
    def test_missing_engines_degrade_to_null_not_500(self, client, chain, monkeypatch):
        real_import = oa.importlib.import_module

        def blocked(name, *args, **kwargs):
            if name in ENGINE_MODULES:
                raise ModuleNotFoundError(name)
            return real_import(name, *args, **kwargs)

        monkeypatch.setattr(oa.importlib, "import_module", blocked)
        response = client.get("/api/options/analytics/NIFTY")
        assert response.status_code == 200
        body = response.json()
        for key in ("positioning", "dealer", "liquidity", "rnd"):
            assert body["expiries"][0][key] is None
        assert body["rv"] is None
        assert oa.RV_UNAVAILABLE_WARNING in body["warnings"]

    def test_odd_return_shapes_are_null_not_500(self, client, chain, monkeypatch):
        _install(monkeypatch, "api.options_positioning",
                 positioning_block=lambda rows, spot: [1, 2, 3])
        _install(monkeypatch, "api.options_dealer",
                 dealer_block=lambda rows, spot, dte_years: "not-a-dict")
        _install(monkeypatch, "api.options_liquidity",
                 liquidity_block=lambda rows: 42)
        _install(monkeypatch, "api.options_rnd",
                 risk_neutral_density=lambda points, spot, dte: object())
        _install(monkeypatch, "api.options_rv",
                 realized_vol_cone=lambda symbol: object(),
                 iv_vs_rv=lambda expiries, cone: None)

        response = client.get("/api/options/analytics/NIFTY")
        assert response.status_code == 200
        body = response.json()
        for key in ("positioning", "dealer", "liquidity", "rnd"):
            assert body["expiries"][0][key] is None
        assert body["rv"] is None

    def test_one_engine_exception_is_isolated_per_expiry(self, client, chain, monkeypatch):
        calls = {"n": 0}

        def flaky(rows, spot):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("bad chain")
            return {"ok": True}

        _install(monkeypatch, "api.options_positioning", positioning_block=flaky)
        _install(monkeypatch, "api.options_dealer",
                 dealer_block=lambda rows, spot, dte_years: {"gex": 1.0})
        _install(monkeypatch, "api.options_liquidity",
                 liquidity_block=lambda rows: {"volume": 10})
        _install(monkeypatch, "api.options_rnd",
                 risk_neutral_density=lambda points, spot, dte: {"density": []})
        _install(monkeypatch, "api.options_rv",
                 realized_vol_cone=lambda symbol: {"cone": []},
                 iv_vs_rv=lambda expiries, cone: {})

        body = client.get("/api/options/analytics/NIFTY").json()
        assert body["expiries"][0]["positioning"] is None
        assert body["expiries"][1]["positioning"] == {"ok": True}
        assert body["expiries"][2]["positioning"] == {"ok": True}
        assert body["expiries"][0]["atmIv"] is not None  # core analytics intact


class TestRealizedVol:
    def test_rv_failure_does_not_break_analytics(self, client, chain, monkeypatch):
        _install_chain_engines(monkeypatch)
        calls = []

        def boom(symbol):
            calls.append(symbol)
            raise RuntimeError("daily history down")

        def compare(expiries, cone):
            calls.append("compare")
            return {"should": "not be called"}

        _install(monkeypatch, "api.options_rv",
                 realized_vol_cone=boom, iv_vs_rv=compare)

        response = client.get("/api/options/analytics/NIFTY")
        assert response.status_code == 200
        body = response.json()
        assert body["rv"] is None
        assert oa.RV_UNAVAILABLE_WARNING in body["warnings"]
        assert body["expiries"][0]["positioning"] == {"pcr": 1.0}
        assert body["expiries"][0]["atmIv"] is not None
        assert calls == ["NIFTY"]  # one daily-history attempt, never retried here

    def test_rv_is_cached_across_an_analytics_cache_bust(self, client, chain, monkeypatch):
        _install_chain_engines(monkeypatch)
        counts = {"rv": 0}

        def cone(symbol):
            counts["rv"] += 1
            return {"cone": [[1, 12.0]]}

        _install(monkeypatch, "api.options_rv",
                 realized_vol_cone=cone, iv_vs_rv=lambda expiries, c: {"n": len(expiries)})

        assert client.get("/api/options/analytics/NIFTY").status_code == 200
        # Drop only the analytics entries; the RV cache must keep the daily-history read warm.
        for key in [k for k in ou._cache if k.startswith(oa._ANALYTICS_KEY_PREFIX)]:
            ou._cache.pop(key, None)
        assert client.get("/api/options/analytics/NIFTY").status_code == 200
        assert counts["rv"] == 1

    def test_iv_vs_rv_is_recomputed_for_a_new_expiry_count(self, client, chain, monkeypatch):
        """The cached cone must not leak a stale comparison across ``?expiries=``."""
        from api.rate_limit import TokenBucketLimiter

        monkeypatch.setattr(oa, "analytics_limiter", TokenBucketLimiter(100, 60.0))
        _install_chain_engines(monkeypatch)
        counts = {"cone": 0}

        def cone(symbol):
            counts["cone"] += 1
            return {"cone": [[30, 12.0]]}

        def compare(expiries, c):
            return {"rows": [{"date": e.get("date")} for e in expiries]}

        _install(monkeypatch, "api.options_rv",
                 realized_vol_cone=cone, iv_vs_rv=compare)

        first = client.get("/api/options/analytics/NIFTY?expiries=1").json()
        second = client.get("/api/options/analytics/NIFTY?expiries=3").json()

        assert len(first["rv"]["ivVsRv"]["rows"]) == 1
        assert len(second["rv"]["ivVsRv"]["rows"]) == 3
        assert counts["cone"] == 1  # cone itself is still cached per symbol
        assert second["rv"]["cone"] == first["rv"]["cone"]
        assert oa.RV_UNAVAILABLE_WARNING not in second["warnings"]

    def test_failed_cone_stays_cached_and_skips_comparison(self, monkeypatch):
        counts = {"cone": 0, "compare": 0}

        def cone(symbol):
            counts["cone"] += 1
            return {"warnings": ["provider_unavailable: upstream"]}

        def compare(expiries, c):
            counts["compare"] += 1
            return {"rows": []}

        _install(monkeypatch, "api.options_rv",
                 realized_vol_cone=cone, iv_vs_rv=compare)

        assert oa._rv_block("NIFTY", [{"date": "a"}]) == (None, True)
        assert oa._rv_block("NIFTY", [{"date": "a"}, {"date": "b"}]) == (None, True)
        assert counts == {"cone": 1, "compare": 0}


class TestRvOffEventLoop:
    """A cold RV read must not block the event loop, and must still degrade.

    ``_load_analytics`` is async; a slow provider daily-history fetch used to run
    inline on the loop and stall every other analytics request. These tests drive
    that coroutine directly with a blocking fake engine and a loop heartbeat: if
    the RV read is offloaded, the blocking ``time.sleep`` holds only a worker
    thread and the heartbeat keeps ticking.
    """

    def _drive(self, monkeypatch, slow_cone):
        observed = {"rv_thread": None}
        main_thread = threading.get_ident()
        ticks = {"n": 0}

        def cone(symbol):
            observed["rv_thread"] = threading.get_ident()
            return slow_cone(symbol)

        _install(monkeypatch, "api.options_rv",
                 realized_vol_cone=cone,
                 iv_vs_rv=lambda expiries, c: {"rows": len(expiries)})

        async def underlying(symbol):
            return {
                "fno": True,
                "quotes_live": True,
                "expiries": [{"date": "2026-11-17", "dte_days": 1}],
            }

        payload = {
            "chain": _chain(),
            "spot": SPOT,
            "levels": {"step": 100.0, "gex": {}},
            "quotes_live": True,
            "session_date": "2026-11-16",
            "data_as_of": "2026-11-16T10:30:00+05:30",
        }

        async def fake_cached(key, loader, *args, **kwargs):
            return payload

        def fake_entry(expiry, chain_payload, view=None):
            return oa.ExpiryAnalytics(date=str(expiry.get("date") or ""))

        monkeypatch.setattr(oa, "_underlying_payload", underlying)
        monkeypatch.setattr(oa, "_cached", fake_cached)
        monkeypatch.setattr(oa, "_expiry_entry", fake_entry)
        monkeypatch.setattr(oa, "_warnings", lambda *a, **k: [])
        monkeypatch.setattr(oa, "_rnd_warnings", lambda *a, **k: [])

        async def heartbeat():
            while True:
                ticks["n"] += 1
                await asyncio.sleep(0.001)

        async def scenario():
            task = asyncio.create_task(heartbeat())
            try:
                return await oa._load_analytics("NIFTY", 1, "open")
            finally:
                task.cancel()

        body = asyncio.run(scenario())
        return body, observed["rv_thread"], main_thread, ticks["n"]

    def test_slow_rv_read_runs_off_event_loop(self, monkeypatch):
        def slow_cone(symbol):
            time.sleep(0.15)
            return {"symbol": symbol, "warnings": [], "cone": [[30, 12.0]]}

        body, rv_thread, main_thread, ticks = self._drive(monkeypatch, slow_cone)

        assert body["rv"]["cone"]["symbol"] == "NIFTY"
        assert rv_thread is not None and rv_thread != main_thread
        assert ticks > 20, "event loop stalled during the blocking RV fetch"

    def test_slow_rv_failure_still_degrades_without_blocking(self, monkeypatch):
        def slow_boom(symbol):
            time.sleep(0.15)
            raise RuntimeError("daily history down")

        body, rv_thread, main_thread, ticks = self._drive(monkeypatch, slow_boom)

        assert body["rv"] is None
        assert oa.RV_UNAVAILABLE_WARNING in body["warnings"]
        assert rv_thread is not None and rv_thread != main_thread
        assert ticks > 20


class TestUnchangedContract:
    def test_cache_and_engines_are_not_recomputed_on_warm_read(self, client, chain, monkeypatch):
        counts = {"pos": 0, "rv": 0}

        def positioning(rows, spot):
            counts["pos"] += 1
            return {"pcr": 1.0}

        _install(monkeypatch, "api.options_positioning", positioning_block=positioning)
        _install(monkeypatch, "api.options_dealer",
                 dealer_block=lambda rows, spot, dte_years: {"gex": 1.0})
        _install(monkeypatch, "api.options_liquidity",
                 liquidity_block=lambda rows: {"volume": 10})
        _install(monkeypatch, "api.options_rnd",
                 risk_neutral_density=lambda points, spot, dte: {"density": []})

        def cone(symbol):
            counts["rv"] += 1
            return {"cone": []}

        _install(monkeypatch, "api.options_rv",
                 realized_vol_cone=cone, iv_vs_rv=lambda expiries, c: {})

        assert client.get("/api/options/analytics/NIFTY").status_code == 200
        assert client.get("/api/options/analytics/NIFTY").status_code == 200
        assert len(chain["calls"]) == 3  # one chain build per expiry, not per request
        assert counts == {"pos": 3, "rv": 1}  # cold build only

    def test_existing_warnings_propagate_alongside_new_blocks(self, client, chain, monkeypatch):
        _install_chain_engines(monkeypatch)
        _install(monkeypatch, "api.options_rv",
                 realized_vol_cone=lambda symbol: {"cone": []},
                 iv_vs_rv=lambda expiries, cone: {})
        chain["thin"] = True
        chain["degraded"] = True
        chain["quotes_live"] = False

        body = client.get("/api/options/analytics/NIFTY").json()
        assert {"quotes_not_live", "gex_degraded", "thin_chain"} <= set(body["warnings"])
        assert body["expiries"][0]["positioning"] == {"pcr": 1.0}

    def test_response_model_exposes_all_new_fields(self):
        assert {"positioning", "dealer", "liquidity", "rnd"} <= set(
            oa.ExpiryAnalytics.model_fields
        )
        assert "rv" in oa.OptionsAnalyticsResponse.model_fields


class TestSinglePassParity:
    """One flatten per expiry feeds warnings, grid and entry; the wire is unchanged."""

    @staticmethod
    def _rich_chain(seed):
        def leg(iv, delta, oi=1_000, gamma=0.01, valid=True, greeks=True):
            out = {"market_data": {"ltp": 100.0, "oi": oi}, "iv_valid": valid}
            if greeks:
                out["option_greeks"] = {"iv": iv, "delta": delta, "gamma": gamma}
            return out

        return [
            {"strike": 24_700.0, "ce": None, "pe": leg(19.0, -0.15)},
            {"strike": 24_800.0, "ce": None, "pe": leg(17.5, -0.30, oi=2_000, gamma=0.02)},
            {"strike": 24_900.0, "ce": None, "pe": leg(17.0, -0.45, valid=False)},
            {"strike": 25_000.0, "ce": leg(16.5, 0.52, gamma=0.03),
             "pe": leg(16.4, -0.52, gamma=0.03)},
            {"strike": 25_100.0, "ce": leg(16.0, 0.45, oi=3_000), "pe": None},
            {"strike": 25_200.0, "ce": leg(16.5, 0.30, gamma=seed), "pe": None},
            {"strike": 25_300.0, "ce": leg(18.0, 0.15, greeks=False), "pe": None},
            {"strike": None, "ce": leg(99.0, 0.1), "pe": leg(99.0, -0.1)},
            "not-a-dict",
            {"strike": 25_400.0, "ce": "not-a-leg", "pe": leg(20.0, -0.1, gamma=0.0)},
        ]

    def test_single_flatten_per_expiry_and_numerical_parity(self, client, monkeypatch):
        dates = ["2026-11-17", "2026-11-24"]

        async def underlying(symbol):
            return {
                "fno": True, "quotes_live": True,
                "expiries": [{"date": d, "dte_days": i + 1} for i, d in enumerate(dates)],
            }

        async def build(symbol, expiry, session_state):
            seed = 0.01 if expiry == dates[0] else 0.0
            return {
                "spot": SPOT, "chain": self._rich_chain(seed),
                "levels": {"step": 100.0, "thin": expiry == dates[1],
                           "gex": {"degraded": expiry == dates[1]}},
                "quotes_live": True, "session_date": "2026-11-16",
                "data_as_of": "2026-11-16T10:30:00+05:30",
            }

        monkeypatch.setattr(oa, "_underlying_payload", underlying)
        monkeypatch.setattr(opts, "_build_chain_response", build)
        _install(monkeypatch, "api.options_positioning",
                 positioning_block=lambda rows, spot: {"pcr": 1.25, "n": len(rows)})
        _install(monkeypatch, "api.options_dealer",
                 dealer_block=lambda rows, spot, dte: {"gex": round(dte, 6), "n": len(rows)})
        _install(monkeypatch, "api.options_liquidity",
                 liquidity_block=lambda rows: {"volume": 10, "n": len(rows)})
        _install(monkeypatch, "api.options_rnd",
                 risk_neutral_density=lambda rows, spot, dte: {
                     "density": [{"k": 100.0, "q": 0.5}], "n": len(rows)})
        _install(monkeypatch, "api.options_rv",
                 realized_vol_cone=lambda symbol: {"cone": [[30, 12.0]]},
                 iv_vs_rv=lambda expiries, cone: {"n": len(expiries)})

        calls = {"n": 0}
        real_view = oa._chain_view

        def spy(chain):
            calls["n"] += 1
            return real_view(chain)

        monkeypatch.setattr(oa, "_chain_view", spy)

        body = client.get("/api/options/analytics/NIFTY?expiries=2").json()
        assert calls["n"] == 2  # one flatten per expiry, shared by warnings/entry/grid

        assert body["warnings"] == ["gex_degraded", "thin_chain", "missing_greeks"]
        first, second = body["expiries"]
        for entry in (first, second):
            assert set(entry) == {
                "date", "dteDays", "spot", "atmIv", "iv", "metrics", "levels",
                "positioning", "dealer", "liquidity", "rnd",
            }
            assert entry["atmIv"] == pytest.approx(16.45)
            assert entry["metrics"] == {
                "rr25": None, "fly25": None, "slope": None, "r2": None, "n": 4,
            }
            assert [r["strike"] for r in entry["iv"]] == [
                24_700.0, 24_800.0, 24_900.0, 25_000.0,
                25_100.0, 25_200.0, 25_300.0, 25_400.0,
            ]
            assert entry["iv"][0]["peIv"] == pytest.approx(19.0)
            assert entry["iv"][2]["peIv"] is None  # iv_valid=False stays null, not 0
            assert entry["iv"][6]["ceOi"] == 1_000.0  # no greeks, OI still survives
            assert entry["positioning"] == {"pcr": 1.25, "n": 10}
            assert entry["liquidity"] == {"volume": 10, "n": 10}
            assert entry["rnd"] == {"density": [{"k": 100.0, "q": 0.5}], "n": 10}
        assert first["dealer"] == {"gex": round(1 / 365, 6), "n": 10}
        assert second["dealer"] == {"gex": round(2 / 365, 6), "n": 10}
        assert first["levels"]["gex"]["gamma_coverage"] == pytest.approx(0.4375)
        assert second["levels"]["gex"]["gamma_coverage"] == pytest.approx(0.375)
        assert body["rv"] == {"cone": {"cone": [[30, 12.0]]}, "ivVsRv": {"n": 2}}

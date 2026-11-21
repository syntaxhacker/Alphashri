"""``GET /api/options/analytics/{underlying}`` — multi-expiry analytics.

Every upstream is mocked: the underlying ladder is patched at the analytics
module boundary and each chain at ``api.options._build_chain_response`` (the
function the real chain route caches). Tests pin the wire shape, ordering,
nullable-IV preservation, synthetic smile values, the 503 failure mode and the
single-flight cache.
"""

import sys
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


DATES = ["2026-11-17", "2026-11-24", "2026-12-01", "2026-12-15"]
SPOT = 25_000.0


@pytest.fixture(autouse=True)
def _reset_caches():
    ou._cache.clear()
    ou._locks.clear()
    yield
    ou._cache.clear()
    ou._locks.clear()


@pytest.fixture
def client(monkeypatch):
    app = FastAPI()
    app.include_router(oa.router)

    async def session_now():
        return "open"

    monkeypatch.setattr(oa, "_session_state_now", session_now)
    return TestClient(app)


def _leg(iv, delta, oi=1_000, ltp=100.0, valid=True, gamma=0.01) -> dict:
    return {
        "market_data": {"ltp": ltp, "oi": oi},
        "option_greeks": {"iv": iv, "delta": delta, "gamma": gamma},
        "iv_valid": valid,
    }


def _row(strike, ce=None, pe=None) -> dict:
    return {"strike": float(strike), "ce": ce, "pe": pe}


def _smile_rows(spot=SPOT) -> list[dict]:
    """Six OTM points making 25-delta call 17, put 18, ATM 16.5."""
    return [
        _row(24_700, pe=_leg(19.0, -0.15)),
        _row(24_800, pe=_leg(17.5, -0.30)),
        _row(24_900, pe=_leg(17.0, -0.45)),
        _row(25_100, ce=_leg(16.0, 0.45)),
        _row(25_200, ce=_leg(16.5, 0.30)),
        _row(25_300, ce=_leg(18.0, 0.15)),
    ]


def _levels(thin=False, degraded=False) -> dict:
    return {
        "spot": SPOT,
        "step": 100.0,
        "thin": thin,
        "call_wall": {"strike": 25_200.0},
        "put_wall": {"strike": 24_800.0},
        "max_pain": {"strike": 25_000.0},
        "gex": {
            "support": None,
            "resistance": None,
            "flip": None,
            "regime": "long",
            "degraded": degraded,
        },
    }


def _chain_payload(expiry, rows=None, thin=False, degraded=False, quotes_live=True) -> dict:
    return {
        "status": "ok",
        "expiry": expiry,
        "spot": SPOT,
        "chain": rows if rows is not None else _smile_rows(),
        "levels": _levels(thin=thin, degraded=degraded),
        "market_state": "open" if quotes_live else "closed",
        "quotes_live": quotes_live,
        "session_date": "2026-11-16",
        "data_as_of": "2026-11-16T10:30:00+05:30",
    }


def _underlying(dates=None, quotes_live=True) -> dict:
    dates = dates or DATES
    return {
        "symbol": "NIFTY",
        "fno": True,
        "spot": SPOT,
        "quotes_live": quotes_live,
        "market_state": "open" if quotes_live else "closed",
        "expiries": [
            {"date": d, "dte_days": i + 1, "weekly": True, "lot_size": 65, "tick_size": 0.05}
            for i, d in enumerate(dates)
        ],
    }


@pytest.fixture
def chain_builder(monkeypatch):
    """Patch both boundaries; return a recorder for the fake chain calls."""
    state = {
        "expiries": DATES, "rows": None, "calls": [],
        "thin": False, "degraded": False, "quotes_live": True,
    }

    monkeypatch.setattr(oa, "_underlying_payload", lambda symbol: _async_value(
        _underlying(state["expiries"], quotes_live=state["quotes_live"])
    ))

    def build(symbol, expiry, session_state):
        state["calls"].append(expiry)
        return _async_value(_chain_payload(
            expiry,
            rows=state["rows"],
            thin=state["thin"],
            degraded=state["degraded"],
        ))

    monkeypatch.setattr(opts, "_build_chain_response", build)
    return state


async def _async_value(value):
    return value


class TestShape:
    def test_full_response_shape(self, client, chain_builder):
        body = client.get("/api/options/analytics/NIFTY").json()

        assert body["symbol"] == "NIFTY"
        assert body["spot"] == SPOT
        assert body["marketState"] == "open"
        assert body["quotesLive"] is True
        assert body["sessionDate"] == "2026-11-16"
        assert body["asOf"] == "2026-11-16T10:30:00+05:30"
        assert isinstance(body["warnings"], list)
        assert len(body["expiries"]) == 3

        entry = body["expiries"][0]
        assert set(entry) == {
            "date", "dteDays", "spot", "atmIv", "iv", "metrics", "levels",
            "positioning", "dealer", "liquidity", "rnd",
        }
        assert set(entry["metrics"]) == {"rr25", "fly25", "slope", "r2", "n"}
        assert entry["levels"]["max_pain"]["strike"] == SPOT
        assert entry["iv"][0]["strike"] == 24_700.0
        assert set(entry["iv"][0]) == {
            "strike", "ceIv", "peIv", "ceDelta", "peDelta", "ceOi", "peOi",
        }

    def test_route_is_public(self, client, chain_builder):
        assert client.get("/api/options/analytics/nifty").status_code == 200


class TestOrdering:
    def test_nearest_three_sorted(self, client, chain_builder):
        chain_builder["expiries"] = list(reversed(DATES))
        body = client.get("/api/options/analytics/NIFTY").json()
        assert [e["date"] for e in body["expiries"]] == DATES[:3]

    def test_expiries_param_capped_at_six(self, client, chain_builder):
        assert client.get("/api/options/analytics/NIFTY?expiries=2").status_code == 200
        assert len(client.get("/api/options/analytics/NIFTY?expiries=2",
                              ).json()["expiries"]) == 2
        assert client.get("/api/options/analytics/NIFTY?expiries=7").status_code == 422


class TestNullableIv:
    def test_invalid_iv_is_null_not_zero(self, client, chain_builder):
        rows = _smile_rows()
        rows.append(_row(25_400, ce=_leg(117.0, 0.10, valid=False)))
        rows.append(_row(25_500, pe=_leg(None, -0.10, valid=False)))
        chain_builder["rows"] = rows
        body = client.get("/api/options/analytics/NIFTY").json()

        by_strike = {r["strike"]: r for r in body["expiries"][0]["iv"]}
        assert by_strike[25_400.0]["ceIv"] is None
        assert by_strike[25_500.0]["peIv"] is None
        assert by_strike[24_700.0]["peIv"] == pytest.approx(19.0)
        assert by_strike[25_400.0]["ceDelta"] == pytest.approx(0.10)


class TestSmileMetrics:
    def test_rr_fly_and_fit_on_synthetic_smile(self, client, chain_builder):
        entry = client.get("/api/options/analytics/NIFTY").json()["expiries"][0]

        assert entry["atmIv"] == pytest.approx(16.5, abs=0.01)
        assert entry["metrics"]["rr25"] == pytest.approx(-1.0, abs=0.01)
        assert entry["metrics"]["fly25"] == pytest.approx(1.0, abs=0.01)
        assert entry["metrics"]["n"] == 6
        assert entry["metrics"]["r2"] is not None
        assert 0.0 <= entry["metrics"]["r2"] <= 1.0


class TestWarnings:
    def test_all_warning_flags(self, client, chain_builder):
        chain_builder["thin"] = True
        chain_builder["degraded"] = True
        rows = _smile_rows()
        rows[0]["pe"]["option_greeks"]["delta"] = None  # missing greeks
        rows[1]["pe"]["option_greeks"]["iv"] = None     # missing IV print
        for row in rows[:4]:                            # coverage 2/6 < 60%
            leg = row.get("pe") or row.get("ce")
            leg["iv_valid"] = False
        chain_builder["rows"] = rows
        chain_builder["quotes_live"] = False

        warnings = client.get("/api/options/analytics/NIFTY").json()["warnings"]
        assert set(warnings) >= {
            "quotes_not_live",
            "iv_coverage_below_60pct",
            "gex_degraded",
            "thin_chain",
            "missing_greeks",
        }


class TestGammaCoverage:
    @staticmethod
    def _rows(n_with_gamma, total=6):
        """Both CE and PE legs at every near-ATM strike, gamma as controlled."""
        rows = []
        for i in range(total):
            gamma = 0.01 if i < n_with_gamma else 0.0
            rows.append(_row(
                24_700.0 + 100.0 * i,
                ce=_leg(16.0, 0.4, gamma=gamma),
                pe=_leg(17.0, -0.4, gamma=gamma),
            ))
        return rows

    def test_coverage_is_reported_in_levels_gex(self, client, chain_builder):
        chain_builder["rows"] = self._rows(6)
        body = client.get("/api/options/analytics/NIFTY").json()
        gex = body["expiries"][0]["levels"]["gex"]

        assert gex["gamma_coverage"] == pytest.approx(1.0)
        assert "gex_degraded" not in body["warnings"]

    def test_zero_gamma_warns_even_without_the_degraded_flag(self, client, chain_builder):
        chain_builder["rows"] = self._rows(0)
        body = client.get("/api/options/analytics/NIFTY").json()
        gex = body["expiries"][0]["levels"]["gex"]

        assert gex["gamma_coverage"] == 0.0
        assert gex["degraded"] is False  # warning came from coverage, not the flag
        assert "gex_degraded" in body["warnings"]

    def test_partial_coverage_below_floor_warns(self, client, chain_builder):
        chain_builder["rows"] = self._rows(2)  # 2/6 ~ 0.33
        body = client.get("/api/options/analytics/NIFTY").json()
        gex = body["expiries"][0]["levels"]["gex"]

        assert gex["gamma_coverage"] == pytest.approx(2 / 6)
        assert "gex_degraded" in body["warnings"]

    def test_coverage_at_floor_does_not_warn(self, client, chain_builder):
        chain_builder["rows"] = self._rows(3)  # 3/6 = 0.5 exactly
        body = client.get("/api/options/analytics/NIFTY").json()
        gex = body["expiries"][0]["levels"]["gex"]

        assert gex["gamma_coverage"] == pytest.approx(0.5)
        assert "gex_degraded" not in body["warnings"]


class TestFailure:
    def test_empty_chain_is_structured_503(self, client, chain_builder, monkeypatch):
        def empty(symbol, expiry, session_state):
            return _async_value({})

        monkeypatch.setattr(opts, "_build_chain_response", empty)
        response = client.get("/api/options/analytics/NIFTY")
        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "analytics_unavailable"

    def test_chain_exception_is_503_not_500(self, client, chain_builder, monkeypatch):
        def boom(symbol, expiry, session_state):
            raise RuntimeError("upstream exploded")

        monkeypatch.setattr(opts, "_build_chain_response", boom)
        response = client.get("/api/options/analytics/NIFTY")
        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "analytics_unavailable"


class TestCache:
    def test_two_requests_make_one_chain_call(self, client, chain_builder):
        assert client.get("/api/options/analytics/NIFTY").status_code == 200
        assert client.get("/api/options/analytics/NIFTY").status_code == 200
        assert len(chain_builder["calls"]) == 3  # one build per expiry, cached on the 2nd call


class TestContract:
    def test_route_metadata(self):
        route = next(r for r in oa.router.routes if getattr(r, "path", "").endswith("/analytics/{underlying}"))
        assert "GET" in route.methods
        assert route.tags == ["options"]
        assert route.summary
        assert route.response_model is oa.OptionsAnalyticsResponse


class TestRateLimit:
    @pytest.fixture(autouse=True)
    def _reset_limiter(self, monkeypatch):
        from api.rate_limit import TokenBucketLimiter

        monkeypatch.setattr(oa, "analytics_limiter", TokenBucketLimiter(30, 60.0))

    def _limiter(self, monkeypatch, capacity):
        from api.rate_limit import TokenBucketLimiter

        monkeypatch.setattr(oa, "analytics_limiter", TokenBucketLimiter(capacity, 60.0))

    def test_cold_request_consumes_a_token(self, client, chain_builder, monkeypatch):
        self._limiter(monkeypatch, 1)
        assert client.get("/api/options/analytics/NIFTY?expiries=1").status_code == 200
        # A different symbol is a different cold cache key, so the spent token
        # must now be gone.
        assert client.get("/api/options/analytics/BANKNIFTY?expiries=1").status_code == 429

    def test_warm_cache_does_not_consume_a_token(self, client, chain_builder, monkeypatch):
        self._limiter(monkeypatch, 6)
        assert client.get("/api/options/analytics/NIFTY?expiries=6").status_code == 200
        # Budget is now empty, but a warm read is free.
        assert client.get("/api/options/analytics/NIFTY?expiries=6").status_code == 200
        assert client.get("/api/options/analytics/BANKNIFTY?expiries=6").status_code == 429

    def test_429_has_retry_after_and_fixed_detail(self, client, chain_builder, monkeypatch):
        self._limiter(monkeypatch, 1)
        client.get("/api/options/analytics/NIFTY?expiries=1")
        response = client.get("/api/options/analytics/BANKNIFTY?expiries=1")

        assert response.status_code == 429
        assert int(response.headers["Retry-After"]) >= 1
        assert response.json()["detail"] == {
            "code": "rate_limited",
            "detail": oa.RATE_LIMIT_DETAIL,
        }

    def test_expiries_1_costs_1(self, client, chain_builder, monkeypatch):
        self._limiter(monkeypatch, 2)
        assert client.get("/api/options/analytics/NIFTY?expiries=1").status_code == 200
        assert client.get("/api/options/analytics/BANKNIFTY?expiries=1").status_code == 200
        assert client.get("/api/options/analytics/SENSEX?expiries=1").status_code == 429

    def test_expiries_6_costs_6(self, client, chain_builder, monkeypatch):
        self._limiter(monkeypatch, 6)
        assert client.get("/api/options/analytics/NIFTY?expiries=6").status_code == 200
        # A flat cost of 1 would leave five tokens and let this through.
        assert client.get("/api/options/analytics/BANKNIFTY?expiries=6").status_code == 429

    def test_partial_budget_causes_429(self, client, chain_builder, monkeypatch):
        self._limiter(monkeypatch, 10)
        assert client.get("/api/options/analytics/NIFTY?expiries=6").status_code == 200
        # Four tokens left: a second six-cost build is denied, a four-cost fits.
        assert client.get("/api/options/analytics/BANKNIFTY?expiries=6").status_code == 429
        assert client.get("/api/options/analytics/SENSEX?expiries=4").status_code == 200


class TestColdBuildConcurrency:
    def test_parallel_cold_builds_are_bounded(self, client, chain_builder, monkeypatch):
        import asyncio

        from httpx import ASGITransport, AsyncClient

        from api.rate_limit import TokenBucketLimiter

        state = {"active": 0, "peak": 0}

        async def slow_build(symbol, expiry, session_state):
            state["active"] += 1
            state["peak"] = max(state["peak"], state["active"])
            await asyncio.sleep(0.05)
            state["active"] -= 1
            return _chain_payload(expiry)

        monkeypatch.setattr(opts, "_build_chain_response", slow_build)
        monkeypatch.setattr(oa, "analytics_limiter", TokenBucketLimiter(100, 60.0))

        async def fire():
            app = FastAPI()
            app.include_router(oa.router)
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as ac:
                responses = await asyncio.gather(*[
                    ac.get(f"/api/options/analytics/SYM{i}") for i in range(8)
                ])
            assert all(r.status_code == 200 for r in responses)

        asyncio.run(fire())
        assert state["peak"] >= 2  # builds really did overlap
        assert state["peak"] <= oa.COLD_BUILD_CONCURRENCY


class TestRedaction:
    def test_chain_exception_text_is_not_echoed(self, client, chain_builder, monkeypatch):
        secret = "https://internal.example/v2/option/chain?token=SUPERSECRET"

        def boom(symbol, expiry, session_state):
            raise RuntimeError(f"GET {secret} exploded")

        monkeypatch.setattr(opts, "_build_chain_response", boom)
        response = client.get("/api/options/analytics/NIFTY")

        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "analytics_unavailable"
        assert "SUPERSECRET" not in response.text
        assert "internal.example" not in response.text

    def test_top_level_exception_text_is_not_echoed(self, client, chain_builder, monkeypatch):
        secret = "https://internal.example/upstream?key=TOPSECRET"

        async def boom(symbol, expiries, session_state):
            raise RuntimeError(f"GET {secret} exploded")

        monkeypatch.setattr(oa, "_load_analytics", boom)
        response = client.get("/api/options/analytics/NIFTY")

        assert response.status_code == 503
        assert "TOPSECRET" not in response.text
        assert "internal.example" not in response.text


class TestHttpCaching:
    """Browser cache window and ETag mirror the server cache, not its callers."""

    def test_cache_control_uses_open_ttl(self, client, chain_builder):
        response = client.get("/api/options/analytics/NIFTY")
        assert response.status_code == 200
        assert response.headers["Cache-Control"] == "private, max-age=45"

    def test_cache_control_uses_closed_ttl(self, client, chain_builder, monkeypatch):
        async def closed_now():
            return "closed"

        monkeypatch.setattr(oa, "_session_state_now", closed_now)
        response = client.get("/api/options/analytics/NIFTY")
        assert response.status_code == 200
        assert response.headers["Cache-Control"] == "private, max-age=60"

    def test_etag_present_and_stable_across_warm_reads(self, client, chain_builder):
        first = client.get("/api/options/analytics/NIFTY")
        second = client.get("/api/options/analytics/NIFTY")
        assert first.headers["ETag"].startswith('"')
        assert first.headers["ETag"].endswith('"')
        assert second.headers["ETag"] == first.headers["ETag"]

    def test_etag_survives_an_identical_cache_rebuild(self, client, chain_builder):
        first = client.get("/api/options/analytics/NIFTY")
        oa.clear_analytics_cache()
        second = client.get("/api/options/analytics/NIFTY")

        assert second.status_code == 200
        assert second.headers["ETag"] == first.headers["ETag"]

    def test_if_none_match_returns_304_without_body_or_upstream_calls(
        self, client, chain_builder
    ):
        first = client.get("/api/options/analytics/NIFTY")
        etag = first.headers["ETag"]
        calls_before = len(chain_builder["calls"])

        revalidated = client.get(
            "/api/options/analytics/NIFTY", headers={"If-None-Match": etag}
        )

        assert revalidated.status_code == 304
        assert revalidated.text == ""
        assert revalidated.headers["ETag"] == etag
        assert revalidated.headers["Cache-Control"] == "private, max-age=45"
        assert len(chain_builder["calls"]) == calls_before

    @pytest.mark.parametrize("candidate", ["*", "weak"])
    def test_if_none_match_accepts_star_and_weak(self, client, chain_builder, candidate):
        etag = client.get("/api/options/analytics/NIFTY").headers["ETag"]
        header = "*" if candidate == "*" else "W/" + etag
        response = client.get(
            "/api/options/analytics/NIFTY", headers={"If-None-Match": header}
        )
        assert response.status_code == 304

    def test_if_none_match_mismatch_returns_200(self, client, chain_builder):
        response = client.get(
            "/api/options/analytics/NIFTY", headers={"If-None-Match": '"not-our-etag"'}
        )
        assert response.status_code == 200
        assert response.json()["symbol"] == "NIFTY"
        assert response.headers["ETag"] != '"not-our-etag"'

    def test_503_has_no_cache_headers(self, client, chain_builder, monkeypatch):
        def empty(symbol, expiry, session_state):
            return _async_value({})

        monkeypatch.setattr(opts, "_build_chain_response", empty)
        response = client.get("/api/options/analytics/NIFTY")

        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "analytics_unavailable"
        assert "ETag" not in response.headers
        assert "Cache-Control" not in response.headers

    def test_429_has_no_cache_headers(self, client, chain_builder, monkeypatch):
        from api.rate_limit import TokenBucketLimiter

        monkeypatch.setattr(oa, "analytics_limiter", TokenBucketLimiter(1, 60.0))
        client.get("/api/options/analytics/NIFTY?expiries=1")
        response = client.get("/api/options/analytics/BANKNIFTY?expiries=1")

        assert response.status_code == 429
        assert response.json()["detail"]["code"] == "rate_limited"
        assert int(response.headers["Retry-After"]) >= 1
        assert "ETag" not in response.headers
        assert "Cache-Control" not in response.headers

    def test_route_still_public_with_no_auth_dependency(self, client, chain_builder):
        route = next(
            r for r in oa.router.routes
            if getattr(r, "path", "").endswith("/analytics/{underlying}")
        )
        assert route.dependant.dependencies == []
        assert client.get("/api/options/analytics/NIFTY").status_code == 200

    def test_conditional_cold_request_still_charges_tokens(
        self, client, chain_builder, monkeypatch
    ):
        from api.rate_limit import TokenBucketLimiter

        monkeypatch.setattr(oa, "analytics_limiter", TokenBucketLimiter(1, 60.0))
        # A conditional request on a cold key is still a cold build: it must pay
        # the same token cost and leave no budget for the next client.
        response = client.get(
            "/api/options/analytics/NIFTY?expiries=1",
            headers={"If-None-Match": '"bogus"'},
        )
        assert response.status_code == 200
        assert client.get("/api/options/analytics/BANKNIFTY?expiries=1").status_code == 429

    def test_conditional_warm_request_is_still_free(self, client, chain_builder, monkeypatch):
        from api.rate_limit import TokenBucketLimiter

        monkeypatch.setattr(oa, "analytics_limiter", TokenBucketLimiter(6, 60.0))
        first = client.get("/api/options/analytics/NIFTY?expiries=6")
        assert first.status_code == 200

        # Budget is now empty; a 304 revalidation of the warm entry must be free.
        revalidated = client.get(
            "/api/options/analytics/NIFTY?expiries=6",
            headers={"If-None-Match": first.headers["ETag"]},
        )
        assert revalidated.status_code == 304
        assert client.get("/api/options/analytics/BANKNIFTY?expiries=6").status_code == 429

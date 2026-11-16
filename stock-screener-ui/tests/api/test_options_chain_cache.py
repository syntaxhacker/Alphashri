"""``GET /api/options/chain/{symbol}`` — short-TTL single-flight cache.

The dock polls the chain every 15s and every expiry switch refetches, so the
same underlying+expiry was costing an Upstox round-trip per call (~0.19s warm)
while its sibling ``/underlying`` endpoint was already cached. These tests pin
the contract: one upstream hit per (underlying, expiry, session state) window,
a separate key per expiry/symbol, ``refresh=1`` bypassing, and no error caching.
"""

import sys
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api import options as op  # noqa: E402
from api import options_underlying as ou  # noqa: E402

EXPIRY = "2026-03-17"
CONTRACT_KEY_NIFTY = "NSE_INDEX|Nifty 50"
CONTRACT_KEY_RELIANCE = "NSE_EQ|INE002A01018"


def _chain_payload(spot: float = 25000.0) -> dict:
    return {
        "status": "success",
        "underlying_spot_price": spot,
        "data": [
            {
                "strike_price": 25000,
                "pcr": 1.25,
                "call_options": {
                    "instrument_key": "NSE_FO|123",
                    "trading_symbol": "NIFTY26MAR25000CE",
                    "expiry": EXPIRY,
                    "market_data": {
                        "ltp": 100, "oi": 1000, "prev_oi": 500, "volume": 1000,
                        "bid_price": 99, "bid_qty": 50, "ask_price": 101,
                        "ask_qty": 60, "close_price": 98,
                    },
                    "option_greeks": {
                        "delta": 0.5, "gamma": 0.01, "vega": 10, "theta": -2,
                        "iv": 15, "pop": 40.0,
                    },
                },
                "put_options": {
                    "instrument_key": "NSE_FO|124",
                    "trading_symbol": "NIFTY26MAR25000PE",
                    "expiry": EXPIRY,
                    "market_data": {
                        "ltp": 100, "oi": 1250, "prev_oi": 500, "volume": 1000,
                        "bid_price": 99, "ask_price": 101,
                    },
                    "option_greeks": {
                        "delta": -0.5, "gamma": 0.01, "vega": 10, "theta": -2, "iv": 15,
                    },
                },
            }
        ],
    }


class Upstream:
    """Counts ``/option/chain`` hits; can be told to fail on demand."""

    def __init__(self, payload: dict | None = None):
        self.payload = payload or _chain_payload()
        self.calls: list[str] = []
        self.failure: Exception | None = None

    async def __call__(self, endpoint: str, params: dict | None = None) -> dict:
        self.calls.append(endpoint)
        if self.failure is not None:
            raise self.failure
        if endpoint == "/option/chain":
            return self.payload
        raise AssertionError(f"unexpected endpoint {endpoint}")

    @property
    def chain_calls(self) -> int:
        return self.calls.count("/option/chain")


@pytest.fixture(autouse=True)
def _reset_module_state():
    op.clear_option_chain_cache()
    op._snapshot_last.clear()
    ou._cache.clear()
    ou._locks.clear()
    yield
    op.clear_option_chain_cache()
    op._snapshot_last.clear()
    ou._cache.clear()
    ou._locks.clear()


@pytest.fixture
def frozen():
    """Monday 10:30 IST by default: the F&O session is open."""

    def apply(now=None, cash_open=True, holiday=False):
        fixed = now or ou.datetime(2026, 11, 16, 10, 30, tzinfo=ou.config.IST)
        ou._now = lambda: fixed
        ou._session_flags = lambda _now: (cash_open, holiday)
        return fixed

    original_now, original_flags = ou._now, ou._session_flags
    apply()
    yield apply
    ou._now, ou._session_flags = original_now, original_flags


@pytest.fixture
def client(frozen):
    app = FastAPI()
    app.include_router(op.router)
    return TestClient(app)


@pytest.fixture
def upstream(monkeypatch):
    def install(fake=None):
        fake = fake or Upstream()
        monkeypatch.setattr(op, "fetch_upstox", fake)
        return fake

    return install


def _get(client, symbol="NIFTY", expiry=EXPIRY, **extra):
    params = {"expiry": expiry, **extra}
    return client.get(f"/api/options/chain/{symbol}", params=params)


class TestSingleUpstreamHit:
    def test_two_identical_calls_cost_one_upstream_hit(self, client, upstream):
        fake = upstream()
        first = _get(client)
        second = _get(client)

        assert first.status_code == second.status_code == 200
        assert fake.chain_calls == 1
        assert first.json() == second.json()

    def test_cache_hit_returns_the_cached_timestamp_not_a_fresh_one(self, client, upstream):
        """The timestamp describes when the quotes were read, not when they were served."""
        upstream()
        first = _get(client).json()

        ou._now = lambda: ou.datetime(2026, 11, 16, 10, 31, tzinfo=ou.config.IST)
        second = _get(client).json()

        assert second["timestamp"] == first["timestamp"]
        assert second["spot"] == first["spot"]

    def test_concurrent_requests_share_one_upstream_call(self, upstream):
        import asyncio

        class SlowUpstream(Upstream):
            async def __call__(self, endpoint, params=None):
                await asyncio.sleep(0.02)
                return await super().__call__(endpoint, params)

        fake = upstream(SlowUpstream())

        async def fan_out():
            return await asyncio.gather(
                *(op.get_option_chain("NIFTY", EXPIRY) for _ in range(5))
            )

        results = asyncio.run(fan_out())

        assert fake.chain_calls == 1
        assert {r["spot"] for r in results} == {25000.0}


class TestKeyIsolation:
    def test_a_second_expiry_is_a_second_key(self, client, upstream):
        fake = upstream()
        _get(client, expiry=EXPIRY)
        _get(client, expiry="2026-03-24")

        assert fake.chain_calls == 2

    def test_a_second_symbol_is_a_second_key(self, client, upstream):
        fake = upstream()
        _get(client, symbol="NIFTY")
        _get(client, symbol="RELIANCE")

        assert fake.chain_calls == 2

    def test_underlying_case_does_not_fork_the_key(self, client, upstream):
        """The sibling ``/underlying`` route already echoes the canonical symbol."""
        fake = upstream()
        _get(client, symbol="NIFTY")
        body = _get(client, symbol="nifty").json()

        assert fake.chain_calls == 1
        assert body["underlying"] == "NIFTY"

    def test_a_session_change_is_a_second_key(self, client, upstream, frozen):
        """An open-session chain carries live prints; after the close it must not be replayed."""
        fake = upstream()
        _get(client)
        frozen(now=ou.datetime(2026, 11, 16, 18, 0, tzinfo=ou.config.IST), cash_open=False)
        _get(client)

        assert fake.chain_calls == 2

    def test_expired_entry_refetches(self, client, upstream):
        fake = upstream()
        _get(client)

        key = op._chain_cache_key("NIFTY", EXPIRY, "open")
        ou._cache[key]["ts"] -= op.CHAIN_TTL_OPEN_SEC + 1
        _get(client)

        assert fake.chain_calls == 2


class TestTtlFollowsSession:
    def test_open_session_uses_the_seconds_window(self, client, upstream):
        upstream()
        _get(client)

        entry = ou._cache[op._chain_cache_key("NIFTY", EXPIRY, "open")]
        assert entry["ttl"] == op.CHAIN_TTL_OPEN_SEC
        assert op.CHAIN_TTL_OPEN_SEC < ou.CACHE_TTL_OPEN_SEC

    def test_closed_session_uses_the_wider_window(self, client, upstream, frozen):
        frozen(now=ou.datetime(2026, 11, 16, 18, 0, tzinfo=ou.config.IST), cash_open=False)
        upstream()
        _get(client)

        entry = ou._cache[op._chain_cache_key("NIFTY", EXPIRY, "closed")]
        assert entry["ttl"] == op.CHAIN_TTL_CLOSED_SEC


class TestRefreshBypass:
    def test_refresh_one_refetches_and_replaces_the_entry(self, client, upstream):
        fake = upstream()
        _get(client)
        body = _get(client, refresh=1).json()

        assert fake.chain_calls == 2
        assert body["status"] == "ok"

    def test_the_refreshed_payload_is_then_served_from_cache(self, client, upstream):
        fake = upstream()
        _get(client, refresh=1)
        _get(client)

        assert fake.chain_calls == 1

    def test_a_broker_reconnect_drops_the_cached_chains(self, client, upstream):
        """A reconnect is exactly when the operator expects fresh quotes."""
        fake = upstream()
        _get(client)
        op.clear_option_chain_cache()
        _get(client)

        assert fake.chain_calls == 2


class TestNothingIsCachedOnFailure:
    def test_rate_limit_is_not_cached(self, client, upstream):
        fake = upstream()
        fake.failure = HTTPException(status_code=429, detail="slow down")

        first = _get(client)
        assert first.status_code == 429

        fake.failure = None
        second = _get(client)

        assert second.status_code == 200
        assert fake.chain_calls == 2

    def test_auth_failure_is_not_cached(self, client, upstream):
        fake = upstream()
        fake.failure = HTTPException(status_code=401, detail="token expired")

        assert _get(client).status_code == 401

        fake.failure = None
        assert _get(client).status_code == 200
        assert fake.chain_calls == 2

    def test_auth_is_unchanged_by_the_cache(self, upstream):
        """The chain stayed public before the cache; the cache must not add a gate."""
        upstream()
        app = FastAPI()
        app.include_router(op.router)

        assert TestClient(app).get(f"/api/options/chain/NIFTY?expiry={EXPIRY}").status_code == 200


class TestResponseShape:
    def test_payload_shape_and_summary_survive_the_cache(self, client, upstream):
        upstream()
        first = _get(client).json()
        second = _get(client).json()

        for body in (first, second):
            assert body["status"] == "ok"
            assert body["underlying"] == "NIFTY"
            assert body["expiry"] == EXPIRY
            assert body["spot"] == 25000.0
            assert body["timestamp"]
            assert body["chain"][0]["strike"] == 25000
            summary = body["summary"]
            assert summary["pcr"] == pytest.approx(1.25)
            assert summary["total_ce_oi"] == 1000
            assert summary["total_pe_oi"] == 1250
            assert summary["atm_iv"] == 15
            assert "expected_move" in summary
            assert "max_pain" in summary
            assert "dte" in summary


class TestSnapshotHook:
    """The chain hook is fire-and-forget: throttled, off the request path, silent on failure.

    The shared API conftest stubs ``record_chain_snapshot`` to a no-op; tests
    that need to observe captures replace it with their own recorder.
    """

    @pytest.fixture
    def writer(self, monkeypatch):
        calls = []

        def fake(payload):
            calls.append(payload)
            return 0

        monkeypatch.setattr(op, "record_chain_snapshot", fake)
        return calls

    def test_repeated_calls_in_one_minute_schedule_one_capture(self, client, upstream, writer):
        upstream()
        first = _get(client)
        second = _get(client)

        assert first.status_code == second.status_code == 200
        assert len(writer) == 1
        assert writer[0]["underlying"] == "NIFTY"
        assert writer[0]["expiry"] == EXPIRY

    def test_next_minute_schedules_another_capture(self, client, upstream, frozen, writer):
        upstream()
        _get(client)
        assert len(writer) == 1

        frozen(now=ou.datetime(2026, 11, 16, 10, 31, tzinfo=ou.config.IST))
        refreshed = _get(client, refresh=1)
        assert refreshed.status_code == 200
        assert len(writer) == 2
        assert writer[0]["timestamp"] != writer[1]["timestamp"]

    def test_closed_market_captures_once_per_session(self, client, upstream, frozen, writer):
        frozen(now=ou.datetime(2026, 11, 16, 18, 0, tzinfo=ou.config.IST), cash_open=False)
        upstream()

        first = _get(client).json()
        second = _get(client, refresh=1).json()

        assert first["quotes_live"] is False
        assert first["session_date"] == second["session_date"]
        assert len(writer) == 1

        frozen(now=ou.datetime(2026, 11, 17, 18, 0, tzinfo=ou.config.IST), cash_open=False)
        third = _get(client, refresh=1).json()
        assert third["session_date"] != first["session_date"]
        assert len(writer) == 2

    def test_writer_exception_does_not_change_the_response(self, client, upstream, monkeypatch):
        upstream()

        def boom(payload):
            raise RuntimeError("snapshot DB is down")

        monkeypatch.setattr(op, "record_chain_snapshot", boom)
        response = _get(client)

        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    def test_empty_chain_is_not_captured(self, client, upstream, writer):
        empty = _chain_payload()
        empty["data"] = []
        upstream(Upstream(empty))

        response = _get(client)

        assert response.status_code == 200
        assert response.json()["chain"] == []
        assert writer == []

    def test_upstream_error_is_not_captured(self, client, upstream, writer):
        fake = upstream()
        fake.failure = HTTPException(status_code=429, detail="slow down")

        assert _get(client).status_code == 429
        assert writer == []

    def test_direct_call_without_request_scope_is_not_captured(self, upstream, writer):
        import asyncio

        upstream()
        payload = asyncio.run(op.get_option_chain("NIFTY", EXPIRY))

        assert payload["status"] == "ok"
        assert writer == []

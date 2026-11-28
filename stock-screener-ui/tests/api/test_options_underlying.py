"""E1 — ``GET /api/options/underlying/{symbol}``.

The route answers one question for the option chain: which instrument key,
which expiries with their real lot/tick sizes, and which expiry a chain should
open on. Every upstream call is mocked here; the real-API shape was verified
against ``/v2/option/contract`` (NIFTY lot 65 / tick 5 paise, RELIANCE lot 500).
"""

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.auth import get_current_user  # noqa: E402
from api import options_underlying as ou  # noqa: E402


CONTRACT_KEY_NIFTY = "NSE_INDEX|Nifty 50"
CONTRACT_KEY_RELIANCE = "NSE_EQ|INE002A01018"


def _contract(expiry: str, lot: int, tick: float, weekly: bool, kind: str = "CE", key: str = "") -> dict:
    """``tick`` is what Upstox returns — **paise**, not rupees."""
    return {
        "name": "X",
        "segment": "NSE_FO",
        "expiry": expiry,
        "weekly": weekly,
        "instrument_key": key or f"NSE_FO|{expiry}-{kind}-{lot}",
        "tick_size": tick,
        "lot_size": lot,
        "instrument_type": kind,
        "strike_price": 25000.0,
    }


def _nifty_rows() -> list[dict]:
    return [
        _contract("2026-11-17", 65, 5.0, True, "CE"),
        _contract("2026-11-17", 65, 5.0, True, "PE"),
        _contract("2026-11-24", 65, 5.0, True, "CE"),
        _contract("2026-12-29", 65, 5.0, False, "CE"),
    ]


def _reliance_rows() -> list[dict]:
    return [
        _contract("2026-11-24", 500, 5.0, True, "CE"),
        _contract("2026-12-29", 500, 5.0, False, "CE"),
    ]


class FakeUpstox:
    """Dispatcher for the two upstream endpoints E1 touches."""

    def __init__(self, contracts: list[dict], spot: float = 25144.3):
        self.contracts = contracts
        self.spot = spot
        self.calls: list[str] = []

    async def __call__(self, endpoint: str, params: dict | None = None) -> dict:
        self.calls.append(endpoint)
        if endpoint == "/option/contract":
            return {"status": "success", "data": self.contracts}
        if endpoint == "/market-quote/ltp":
            return {
                "status": "success",
                "data": {
                    "NSE_INDEX:Nifty 50": {
                        "last_price": self.spot,
                        "instrument_token": CONTRACT_KEY_NIFTY,
                    }
                },
            }
        raise AssertionError(f"unexpected endpoint {endpoint}")

    @property
    def contract_calls(self) -> int:
        return self.calls.count("/option/contract")


@pytest.fixture(autouse=True)
def _reset_module_state():
    ou._cache.clear()
    ou._locks.clear()
    yield
    ou._cache.clear()
    ou._locks.clear()


@pytest.fixture
def frozen():
    """Default session: Monday 10:30 IST, cash open, no holiday."""

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
    app.include_router(ou.router)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
    return TestClient(app)


@pytest.fixture
def upstream(monkeypatch):
    def install(fake):
        monkeypatch.setattr(ou, "fetch_upstox", fake)
        return fake

    return install


@pytest.fixture(autouse=True)
def instrument_map(monkeypatch):
    """Symbol -> NSE_EQ key, mirroring the real master without its 45 MB parse."""
    mapping = {"RELIANCE": CONTRACT_KEY_RELIANCE, "TCS": "NSE_EQ|INE467B01029"}

    def resolve(symbol: str) -> str:
        up = str(symbol or "").upper()
        return mapping.get(up, f"NSE_INDEX|{up}")

    monkeypatch.setattr(ou, "get_instrument_key", resolve)
    return mapping


class TestIndexResolution:
    def test_nifty_resolves_to_the_index_key_with_real_lots(self, client, upstream):
        fake = upstream(FakeUpstox(_nifty_rows()))
        body = client.get("/api/options/underlying/NIFTY").json()

        assert body["symbol"] == "NIFTY"
        assert body["exchange"] == "NSE"
        assert body["fno"] is True
        assert body["instrument_key"] == CONTRACT_KEY_NIFTY
        assert body["spot"] == pytest.approx(25144.3)
        assert [e["date"] for e in body["expiries"]] == ["2026-11-17", "2026-11-24", "2026-12-29"]
        assert {e["lot_size"] for e in body["expiries"]} == {65}
        assert {e["tick_size"] for e in body["expiries"]} == {0.05}
        assert body["expiries"][0]["dte_days"] == 1
        assert body["market_state"] == "open"
        assert fake.calls[:2] == ["/option/contract", "/market-quote/ltp"]

    def test_sensex_resolves_to_bse_index(self, client, upstream):
        fake = upstream(FakeUpstox([_contract("2026-11-20", 20, 5.0, True)]))
        body = client.get("/api/options/underlying/SENSEX").json()

        assert body["instrument_key"] == "BSE_INDEX|SENSEX"
        assert body["exchange"] == "BSE"
        assert body["expiries"][0]["lot_size"] == 20
        assert fake.calls == ["/option/contract", "/market-quote/ltp"]

    def test_case_insensitive_symbol(self, client, upstream):
        upstream(FakeUpstox(_nifty_rows()))
        body = client.get("/api/options/underlying/nifty").json()
        assert body["symbol"] == "NIFTY"
        assert body["instrument_key"] == CONTRACT_KEY_NIFTY


class TestTickSizeUnits:
    """Upstox sends paise; E1 must publish rupees or a UI rounds 1339.7 -> 1340."""

    def test_index_five_paise_is_five_hundredths_of_a_rupee(self, client, upstream):
        upstream(FakeUpstox(_nifty_rows()))
        body = client.get("/api/options/underlying/NIFTY").json()

        assert [e["tick_size"] for e in body["expiries"]] == [0.05, 0.05, 0.05]

    def test_sub_250_equity_one_paise_is_one_hundredth(self, client, upstream, monkeypatch):
        monkeypatch.setattr(
            ou, "get_instrument_key", lambda s: "NSE_EQ|INE053F01010"
        )
        upstream(
            FakeUpstox([_contract("2026-11-24", 3050, 1.0, True, key="NSE_FO|ONGC")], spot=133.9)
        )
        body = client.get("/api/options/underlying/ONGC").json()

        assert body["expiries"][0]["tick_size"] == pytest.approx(0.01)

    def test_fractional_paise_is_preserved(self, client, upstream):
        upstream(FakeUpstox([_contract("2026-11-24", 65, 2.5, True)]))
        body = client.get("/api/options/underlying/NIFTY").json()

        assert body["expiries"][0]["tick_size"] == pytest.approx(0.025)

    @pytest.mark.parametrize("raw", [0, 0.0, None])
    def test_missing_upstream_tick_is_zero_rupees(self, client, upstream, raw):
        upstream(FakeUpstox([_contract("2026-11-24", 65, raw, True)]))
        body = client.get("/api/options/underlying/NIFTY").json()

        assert body["expiries"][0]["tick_size"] == 0.0

    def test_no_paise_value_leaks_into_the_payload(self, client, upstream, monkeypatch):
        """Every raw paise value in this test is >= 1, so any rupee value >= 1 is a leak."""
        monkeypatch.setattr(ou, "get_instrument_key", lambda s: "NSE_EQ|INE053F01010")
        rows = [
            _contract("2026-11-24", 65, 5.0, True, key="NSE_FO|A"),
            _contract("2026-12-29", 3050, 1.0, False, key="NSE_FO|B"),
        ]
        upstream(FakeUpstox(rows))
        body = client.get("/api/options/underlying/ONGC").json()

        assert all(e["tick_size"] < 1 for e in body["expiries"])
        assert "tick_size_paise" not in body["expiries"][0]


class TestQuotesLive:
    def test_open_session_has_live_quotes(self, client, upstream):
        upstream(FakeUpstox(_nifty_rows()))
        assert client.get("/api/options/underlying/NIFTY").json()["quotes_live"] is True

    def test_pre_open_quotes_are_the_previous_session(self, client, upstream, frozen):
        frozen(now=ou.datetime(2026, 11, 16, 9, 5, tzinfo=ou.config.IST), cash_open=False)
        upstream(FakeUpstox(_nifty_rows()))
        body = client.get("/api/options/underlying/NIFTY").json()

        assert body["market_state"] == "pre_open"
        assert body["quotes_live"] is False

    def test_closed_session_is_not_live(self, client, upstream, frozen):
        frozen(now=ou.datetime(2026, 11, 16, 18, 0, tzinfo=ou.config.IST), cash_open=False)
        upstream(FakeUpstox(_nifty_rows()))
        body = client.get("/api/options/underlying/NIFTY").json()

        assert body["market_state"] == "closed"
        assert body["quotes_live"] is False

    def test_weekend_is_not_live(self, client, upstream, frozen):
        frozen(now=ou.datetime(2026, 11, 21, 11, 0, tzinfo=ou.config.IST))
        upstream(FakeUpstox(_nifty_rows()))
        body = client.get("/api/options/underlying/NIFTY").json()

        assert body["market_state"] == "closed"
        assert body["quotes_live"] is False

    def test_derivatives_tail_after_cash_close_is_live(self, client, upstream, frozen):
        frozen(now=ou.datetime(2026, 11, 16, 15, 35, tzinfo=ou.config.IST), cash_open=False)
        upstream(FakeUpstox(_nifty_rows()))
        body = client.get("/api/options/underlying/NIFTY").json()

        assert body["market_state"] == "open"
        assert body["quotes_live"] is True

    def test_quotes_live_always_agrees_with_market_state(self, client, upstream, frozen):
        moments = [
            ou.datetime(2026, 11, 16, 8, 0, tzinfo=ou.config.IST),
            ou.datetime(2026, 11, 16, 9, 5, tzinfo=ou.config.IST),
            ou.datetime(2026, 11, 16, 10, 30, tzinfo=ou.config.IST),
            ou.datetime(2026, 11, 16, 15, 35, tzinfo=ou.config.IST),
            ou.datetime(2026, 11, 16, 15, 45, tzinfo=ou.config.IST),
        ]
        upstream(FakeUpstox(_nifty_rows()))
        for moment in moments:
            frozen(now=moment, cash_open=moment.time() < ou.dtime(15, 30))
            body = client.get("/api/options/underlying/NIFTY").json()
            assert body["quotes_live"] is (body["market_state"] == "open"), moment


class TestEquityResolution:
    def test_fno_equity_uses_the_nse_eq_key(self, client, upstream):
        fake = upstream(FakeUpstox(_reliance_rows()))
        body = client.get("/api/options/underlying/RELIANCE").json()

        assert body["instrument_key"] == CONTRACT_KEY_RELIANCE
        assert body["exchange"] == "NSE"
        assert body["fno"] is True
        assert [e["lot_size"] for e in body["expiries"]] == [500, 500]
        assert body["default_expiry"] == "2026-11-24"
        assert fake.calls[0] == "/option/contract"

    def test_equity_without_options_is_200_but_not_fno(self, client, upstream):
        fake = upstream(FakeUpstox([]))
        resp = client.get("/api/options/underlying/TCS")

        assert resp.status_code == 200
        body = resp.json()
        assert body["fno"] is False
        assert body["expiries"] == []
        assert body["default_expiry"] is None
        assert body["spot"] == 0.0
        assert body["instrument_key"] == "NSE_EQ|INE467B01029"
        # An empty listing needs no quote round-trip.
        assert fake.calls == ["/option/contract"]

    def test_unknown_symbol_is_404_not_fno(self, client, upstream):
        fake = upstream(FakeUpstox(_nifty_rows()))
        resp = client.get("/api/options/underlying/NOTAREALTICKER")

        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "not_fno"
        assert fake.calls == []


class TestDefaultExpiry:
    def test_first_future_expiry_is_the_default(self, client, upstream):
        upstream(FakeUpstox(_nifty_rows()))
        body = client.get("/api/options/underlying/NIFTY").json()
        assert body["default_expiry"] == "2026-11-17"

    def test_all_expiries_expired_yields_no_default(self, client, upstream):
        upstream(FakeUpstox([_contract("2026-11-10", 65, 5.0, True)]))
        body = client.get("/api/options/underlying/NIFTY").json()

        assert body["fno"] is True
        assert body["expiries"] == []
        assert body["default_expiry"] is None

    def test_expiry_today_before_close_stays_default(self, client, upstream, frozen):
        frozen(now=ou.datetime(2026, 11, 17, 14, 30, tzinfo=ou.config.IST))
        upstream(FakeUpstox(_nifty_rows()))

        body = client.get("/api/options/underlying/NIFTY").json()
        assert body["default_expiry"] == "2026-11-17"
        assert body["expiries"][0]["dte_days"] == 0
        assert body["market_state"] == "open"

    def test_expiry_today_after_1540_rolls_to_next_but_stays_listed(self, client, upstream, frozen):
        frozen(
            now=ou.datetime(2026, 11, 17, 16, 0, tzinfo=ou.config.IST),
            cash_open=False,
        )
        upstream(FakeUpstox(_nifty_rows()))

        body = client.get("/api/options/underlying/NIFTY").json()

        assert body["default_expiry"] == "2026-11-24"
        assert [e["date"] for e in body["expiries"]][:2] == ["2026-11-17", "2026-11-24"]
        assert body["expiries"][0]["dte_days"] == 0
        assert body["market_state"] == "closed"

    def test_expiry_today_is_still_default_before_the_close(self, client, upstream, frozen):
        frozen(now=ou.datetime(2026, 11, 17, 8, 30, tzinfo=ou.config.IST), cash_open=False)
        upstream(FakeUpstox(_nifty_rows()))

        body = client.get("/api/options/underlying/NIFTY").json()
        # The rollover condition is "now >= 15:40", not "session closed".
        assert body["default_expiry"] == "2026-11-17"
        assert body["market_state"] == "closed"


class TestMarketState:
    def test_pre_open_between_0900_and_0915(self, client, upstream, frozen):
        frozen(now=ou.datetime(2026, 11, 16, 9, 5, tzinfo=ou.config.IST), cash_open=False)
        upstream(FakeUpstox(_nifty_rows()))
        assert client.get("/api/options/underlying/NIFTY").json()["market_state"] == "pre_open"

    def test_derivatives_still_open_between_1530_and_1540(self, client, upstream, frozen):
        frozen(now=ou.datetime(2026, 11, 16, 15, 35, tzinfo=ou.config.IST), cash_open=False)
        upstream(FakeUpstox(_nifty_rows()))
        assert client.get("/api/options/underlying/NIFTY").json()["market_state"] == "open"

    def test_holiday_is_closed(self, client, upstream, frozen):
        frozen(holiday=True)
        upstream(FakeUpstox(_nifty_rows()))
        assert client.get("/api/options/underlying/NIFTY").json()["market_state"] == "closed"


class TestCache:
    def test_second_request_is_served_from_cache(self, client, upstream):
        fake = upstream(FakeUpstox(_nifty_rows()))
        client.get("/api/options/underlying/NIFTY")
        client.get("/api/options/underlying/NIFTY")
        assert fake.contract_calls == 1

    def test_cache_key_is_per_symbol(self, client, upstream, monkeypatch):
        fake = upstream(FakeUpstox(_nifty_rows()))

        def resolve(symbol):
            return CONTRACT_KEY_RELIANCE if symbol.upper() == "RELIANCE" else CONTRACT_KEY_NIFTY

        monkeypatch.setattr(ou, "get_instrument_key", resolve)
        client.get("/api/options/underlying/NIFTY")
        client.get("/api/options/underlying/RELIANCE")
        assert fake.contract_calls == 2

    def test_expired_entry_refetches(self, client, upstream):
        fake = upstream(FakeUpstox(_nifty_rows()))
        client.get("/api/options/underlying/NIFTY")

        ou._cache["NIFTY"]["ts"] -= ou.CACHE_TTL_OPEN_SEC + 1
        client.get("/api/options/underlying/NIFTY")
        assert fake.contract_calls == 2


    def test_cache_ttl_follows_the_session(self, client, upstream, frozen):
        upstream(FakeUpstox(_nifty_rows()))
        client.get("/api/options/underlying/NIFTY")
        assert ou._cache["NIFTY"]["ttl"] == ou.CACHE_TTL_OPEN_SEC

        ou.clear_underlying_cache()
        frozen(
            now=ou.datetime(2026, 11, 16, 18, 0, tzinfo=ou.config.IST),
            cash_open=False,
        )
        client.get("/api/options/underlying/NIFTY")
        assert ou._cache["NIFTY"]["ttl"] == ou.CACHE_TTL_CLOSED_SEC

    def test_concurrent_requests_share_one_upstream_call(self, upstream):
        """Single-flight: ten tabs on one symbol must cost one listing fetch."""
        import asyncio

        class SlowUpstox(FakeUpstox):
            async def __call__(self, endpoint, params=None):
                await asyncio.sleep(0.02)
                return await super().__call__(endpoint, params)

        fake = upstream(SlowUpstox(_nifty_rows()))
        user = SimpleNamespace(id=1)

        async def fan_out():
            return await asyncio.gather(
                *(ou.get_underlying_info("NIFTY", user) for _ in range(5))
            )

        results = asyncio.run(fan_out())

        assert fake.contract_calls == 1
        assert {r["instrument_key"] for r in results} == {CONTRACT_KEY_NIFTY}


class TestUpstreamFailures:
    def test_upstream_401_is_a_structured_401(self, client, upstream):
        async def reject(endpoint, params=None):
            raise HTTPException(status_code=401, detail="Upstox token expired or invalid")

        upstream(reject)
        resp = client.get("/api/options/underlying/NIFTY")

        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == "upstox_auth_required"
        assert "Settings" in resp.json()["detail"]["detail"]

    @pytest.mark.parametrize("upstream_status", [500, 502, 504])
    def test_other_upstream_failures_are_503_never_500(self, client, upstream, upstream_status):
        async def boom(endpoint, params=None):
            raise HTTPException(status_code=upstream_status, detail="upstream broke")

        upstream(boom)
        resp = client.get("/api/options/underlying/NIFTY")

        assert resp.status_code == 503
        assert resp.json()["detail"]["code"] == "upstream_unavailable"

    def test_rate_limited_upstream_is_429(self, client, upstream):
        async def limited(endpoint, params=None):
            raise HTTPException(status_code=429, detail="slow down")

        upstream(limited)
        resp = client.get("/api/options/underlying/NIFTY")

        assert resp.status_code == 429
        assert resp.json()["detail"]["code"] == "rate_limited"

    def test_rate_limited_upstream_has_fixed_retry_after(self, client, upstream):
        """429 carries a constant Retry-After and never echoes upstream text."""
        async def limited(endpoint, params=None):
            raise HTTPException(status_code=429, detail="token=secret slow down")

        upstream(limited)
        resp = client.get("/api/options/underlying/NIFTY")

        assert resp.status_code == 429
        assert resp.headers["Retry-After"] == "5"
        assert "secret" not in resp.text

    def test_spot_failure_keeps_the_listing(self, client, upstream):
        """A dead quote must not hide a valid expiry listing."""

        async def partial(endpoint, params=None):
            if endpoint == "/option/contract":
                return {"status": "success", "data": _nifty_rows()}
            raise HTTPException(status_code=503, detail="quote down")

        upstream(partial)
        body = client.get("/api/options/underlying/NIFTY").json()

        assert body["fno"] is True
        assert body["spot"] == 0.0
        assert len(body["expiries"]) == 3

    def test_network_error_is_a_503_not_a_500(self, client, upstream):
        import httpx

        async def no_network(endpoint, params=None):
            raise httpx.ConnectError("no route to host")

        upstream(no_network)
        resp = client.get("/api/options/underlying/NIFTY")

        assert resp.status_code == 503
        assert resp.json()["detail"]["code"] == "upstream_unavailable"

    def test_malformed_payload_is_not_a_crash(self, client, upstream):
        async def garbage(endpoint, params=None):
            return {"status": "success", "data": None}

        upstream(garbage)
        body = client.get("/api/options/underlying/NIFTY").json()
        assert body["fno"] is False
        assert body["expiries"] == []


class TestAuth:
    def test_requires_a_user(self, upstream):
        upstream(FakeUpstox(_nifty_rows()))
        app = FastAPI()
        app.include_router(ou.router)
        resp = TestClient(app).get("/api/options/underlying/NIFTY")
        assert resp.status_code == 401


class TestRegistryPin:
    """The public options table and the instrument registry must not drift."""

    def test_available_underlyings_covers_exactly_index_aliases(self):
        from api.options import AVAILABLE_UNDERLYINGS

        by_symbol = {entry["symbol"]: entry for entry in AVAILABLE_UNDERLYINGS}
        assert len(by_symbol) == len(AVAILABLE_UNDERLYINGS)
        assert set(by_symbol) == set(ou.INDEX_ALIASES)

    def test_index_contract_meta_covers_exactly_index_aliases(self):
        """A new alias without metadata must fail here, not at request time."""
        assert set(ou.INDEX_CONTRACT_META) == set(ou.INDEX_ALIASES)

    def test_instrument_keys_and_contract_meta_are_shared(self):
        from api.options import AVAILABLE_UNDERLYINGS

        for entry in AVAILABLE_UNDERLYINGS:
            symbol = entry["symbol"]
            instrument_key, _exchange = ou.INDEX_ALIASES[symbol]
            meta = ou.INDEX_CONTRACT_META[symbol]
            assert entry["instrument_key"] == instrument_key
            assert entry["name"] == meta["name"]
            assert entry["lot_size"] == meta["lot_size"]
            assert entry["tick_size"] == meta["tick_size"]

    def test_lot_and_tick_are_positive(self):
        from api.options import AVAILABLE_UNDERLYINGS

        for entry in AVAILABLE_UNDERLYINGS:
            assert entry["lot_size"] > 0, entry["symbol"]
            assert entry["tick_size"] > 0, entry["symbol"]

    def test_existing_values_are_unchanged(self):
        """Guard the exact public payload values against accidental edits."""
        from api.options import AVAILABLE_UNDERLYINGS

        # Ticks corrected to ₹0.05: index OPTION premium tick (NSE/FAOP/73928;
        # BSE SENSEX OPTIONS contract spec). The 0.05/0.10/0.20 ladder is futures-only.
        expected = {
            "NIFTY": ("NSE_INDEX|Nifty 50", "Nifty 50", 65, 0.05),
            "BANKNIFTY": ("NSE_INDEX|Nifty Bank", "Nifty Bank", 15, 0.05),
            "FINNIFTY": ("NSE_INDEX|Nifty Fin Service", "Nifty Fin Service", 25, 0.05),
            "MIDCPNIFTY": ("NSE_INDEX|NIFTY MID SELECT", "NIFTY MID SELECT", 50, 0.05),
            "SENSEX": ("BSE_INDEX|SENSEX", "BSE Sensex", 20, 0.05),
        }
        assert {
            entry["symbol"]: (
                entry["instrument_key"],
                entry["name"],
                entry["lot_size"],
                entry["tick_size"],
            )
            for entry in AVAILABLE_UNDERLYINGS
        } == expected


class TestRedaction:
    def test_upstream_http_detail_is_not_echoed(self, client, upstream):
        secret = "https://internal.example/v2/option/contract?token=UPSTREAMSECRET"

        async def boom(endpoint, params=None):
            raise HTTPException(status_code=500, detail=secret)

        upstream(boom)
        resp = client.get("/api/options/underlying/NIFTY")

        assert resp.status_code == 503
        assert resp.json()["detail"]["code"] == "upstream_unavailable"
        assert "UPSTREAMSECRET" not in resp.text
        assert "internal.example" not in resp.text

    def test_network_error_text_is_not_echoed(self, client, upstream):
        import httpx

        secret = "https://internal.example/proxy?key=NETWORKSECRET"

        async def no_network(endpoint, params=None):
            raise httpx.ConnectError(secret)

        upstream(no_network)
        resp = client.get("/api/options/underlying/NIFTY")

        assert resp.status_code == 503
        assert resp.json()["detail"]["code"] == "upstream_unavailable"
        assert "NETWORKSECRET" not in resp.text
        assert "internal.example" not in resp.text

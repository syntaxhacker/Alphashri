"""``GET /api/options/contract-chart`` — one contract's premium candles.

Every upstream call is mocked. The wire shape was verified against V3
``/historical-candle/intraday/NSE_FO%7C106407/minutes/1``: arrays are
``[ts, o, h, l, c, volume, oi]``, newest-first, and minutes without a trade are
absent.
"""

import sys
from datetime import datetime
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api import options_contract_chart as occ  # noqa: E402

CONTRACT = "NSE_FO|106407"
ENCODED = "NSE_FO%7C106407"
BASE = "https://api.upstox.com/v3"


def _bar(ts: str, close: float = 0.21, volume: int = 97650, oi: int = 17739750) -> list:
    return [ts, 0.24, 0.24, 0.20, close, volume, oi]


def _payload(rows: list[list]) -> dict:
    return {"status": "success", "data": {"candles": rows}}


class FakeResponse:
    def __init__(self, status_code: int = 200, payload=None, text: str = ""):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class FakeUpstox:
    """URL-dispatched stand-in for ``httpx.AsyncClient``."""

    def __init__(
        self,
        intraday: dict | None = None,
        historical: dict | None = None,
        *,
        status_code: int = 200,
        raise_exc: Exception | None = None,
    ):
        self.intraday = intraday if intraday is not None else _payload([])
        self.historical = historical if historical is not None else _payload([])
        self.status_code = status_code
        self.raise_exc = raise_exc
        self.calls: list[str] = []

    async def get(self, url: str, headers: dict | None = None):
        self.calls.append(url)
        if self.raise_exc is not None:
            raise self.raise_exc
        payload = self.intraday if "/intraday/" in url else self.historical
        return FakeResponse(self.status_code, payload)


def _install(monkeypatch, fake: FakeUpstox) -> FakeUpstox:
    class Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return fake

        async def __aexit__(self, *exc):
            return False

    monkeypatch.setattr(occ.httpx, "AsyncClient", Client)
    return fake


@pytest.fixture(autouse=True)
def _reset_module_state(monkeypatch):
    fixed = datetime(2026, 11, 17, 11, 0, tzinfo=occ.config.IST)
    monkeypatch.setattr(occ, "_now", lambda: fixed)
    monkeypatch.setattr(occ, "_session_open", lambda: False)
    monkeypatch.setattr(occ, "get_upstox_token", lambda: "test-token")
    occ._cache.clear()
    occ._locks.clear()
    yield
    occ._cache.clear()
    occ._locks.clear()


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(occ.router)
    return TestClient(app)


@pytest.fixture
def upstream(monkeypatch):
    def install(fake: FakeUpstox) -> FakeUpstox:
        return _install(monkeypatch, fake)

    return install


def _get(client, **params):
    return client.get("/api/options/contract-chart", params={"instrument_key": CONTRACT, **params})


class TestIntradayOnly:
    def test_days_one_reads_only_the_current_session_and_sorts_ascending(self, client, upstream):
        fake = upstream(
            FakeUpstox(
                intraday=_payload(
                    [
                        _bar("2026-11-17T09:17:00+05:30", 0.23),
                        _bar("2026-11-17T09:16:00+05:30", 0.22),
                        _bar("2026-11-17T09:15:00+05:30", 0.21),
                    ]
                )
            )
        )
        body = _get(client, days=1).json()

        assert fake.calls == [f"{BASE}/historical-candle/intraday/{ENCODED}/minutes/1"]
        assert [c["t"] for c in body["candles"]] == [
            "2026-11-17T09:15:00+05:30",
            "2026-11-17T09:16:00+05:30",
            "2026-11-17T09:17:00+05:30",
        ]
        assert body["candles"][0] == {
            "t": "2026-11-17T09:15:00+05:30",
            "o": 0.24,
            "h": 0.24,
            "l": 0.20,
            "c": 0.21,
            "v": 97650,
            "oi": 17739750,
        }


class TestHistoricalMerge:
    def test_prior_session_is_merged_deduped_and_sorted(self, client, upstream):
        fake = upstream(
            FakeUpstox(
                historical=_payload(
                    [
                        _bar("2026-11-17T09:15:00+05:30", 0.99),
                        _bar("2026-11-16T15:29:00+05:30", 0.18),
                        _bar("2026-11-16T09:15:00+05:30", 0.15),
                    ]
                ),
                intraday=_payload(
                    [
                        _bar("2026-11-17T09:16:00+05:30", 0.22),
                        _bar("2026-11-17T09:15:00+05:30", 0.21),
                    ]
                ),
            )
        )
        body = _get(client, days=2).json()

        assert fake.calls == [
            f"{BASE}/historical-candle/{ENCODED}/minutes/1/2026-11-17/2026-11-10",
            f"{BASE}/historical-candle/intraday/{ENCODED}/minutes/1",
        ]
        times = [c["t"] for c in body["candles"]]
        assert times == sorted(times)
        assert times == [
            "2026-11-16T09:15:00+05:30",
            "2026-11-16T15:29:00+05:30",
            "2026-11-17T09:15:00+05:30",
            "2026-11-17T09:16:00+05:30",
        ]
        # The running-session bar wins over the historical duplicate.
        assert body["candles"][2]["c"] == 0.21

    def test_days_limits_the_returned_sessions(self, client, upstream):
        upstream(
            FakeUpstox(
                historical=_payload(
                    [
                        _bar("2026-11-17T09:15:00+05:30"),
                        _bar("2026-11-16T09:15:00+05:30"),
                        _bar("2026-11-14T09:15:00+05:30"),
                        _bar("2026-11-13T09:15:00+05:30"),
                    ]
                ),
                intraday=_payload([_bar("2026-11-17T09:16:00+05:30")]),
            )
        )
        body = _get(client, days=2).json()
        assert {c["t"][:10] for c in body["candles"]} == {"2026-11-16", "2026-11-17"}


class TestIntervalUrls:
    @pytest.mark.parametrize(("interval", "unit"), [("1m", "1"), ("5m", "5"), ("15m", "15")])
    def test_interval_selects_the_upstox_minutes_unit(self, client, upstream, interval, unit):
        fake = upstream(FakeUpstox())
        _get(client, interval=interval, days=1)

        assert fake.calls == [f"{BASE}/historical-candle/intraday/{ENCODED}/minutes/{unit}"]

    def test_historical_url_carries_the_same_unit(self, client, upstream):
        fake = upstream(FakeUpstox())
        _get(client, interval="15m", days=2)

        assert fake.calls[0] == (
            f"{BASE}/historical-candle/{ENCODED}/minutes/15/2026-11-17/2026-11-10"
        )


class TestEmpty:
    def test_contract_without_prints_is_a_successful_empty_series(self, client, upstream):
        upstream(FakeUpstox(intraday=_payload([]), historical=_payload([])))
        response = _get(client, days=1)
        body = response.json()

        assert response.status_code == 200
        assert body["candles"] == []
        assert body["empty_reason"] == "no_trades"
        assert body["source"] == "upstox"
        assert body["cached"] is False


class TestValidation:
    @pytest.mark.parametrize(
        "instrument_key",
        ["NSE_EQ|INE002A01018", "NSE_FO|106-407", "NSE_FO|", "nse_fo|106407", "NSE_FO|106407/x"],
    )
    def test_non_nse_fo_contract_keys_are_rejected(self, client, instrument_key):
        response = client.get(
            "/api/options/contract-chart",
            params={"instrument_key": instrument_key},
        )
        assert response.status_code == 400
        assert response.json()["detail"] == occ.INVALID_INSTRUMENT_KEY_DETAIL

    def test_unknown_interval_is_rejected(self, client):
        response = _get(client, interval="2m")
        assert response.status_code == 400
        assert response.json()["detail"] == occ.INVALID_INTERVAL_DETAIL

    @pytest.mark.parametrize("days", [0, 4, -1])
    def test_days_outside_one_to_three_is_rejected(self, client, days):
        response = _get(client, days=days)
        assert response.status_code == 400
        assert response.json()["detail"] == occ.INVALID_DAYS_DETAIL


class TestUpstreamFailures:
    def test_missing_token_maps_to_401(self, client, monkeypatch):
        def no_token():
            raise HTTPException(status_code=401, detail="Connect Upstox in Settings")

        monkeypatch.setattr(occ, "get_upstox_token", no_token)
        response = _get(client, days=1)

        assert response.status_code == 401
        assert response.json()["detail"] == occ.AUTH_REQUIRED_DETAIL

    def test_upstream_401_maps_to_401(self, client, upstream):
        upstream(FakeUpstox(status_code=401))
        response = _get(client, days=1)

        assert response.status_code == 401
        assert response.json()["detail"] == occ.AUTH_REQUIRED_DETAIL

    def test_upstream_5xx_maps_to_502(self, client, upstream):
        upstream(FakeUpstox(status_code=503))
        response = _get(client, days=1)

        assert response.status_code == 502
        assert response.json()["detail"] == occ.UNAVAILABLE_DETAIL

    def test_upstream_timeout_maps_to_504(self, client, upstream):
        upstream(FakeUpstox(raise_exc=httpx.ReadTimeout("timed out")))
        response = _get(client, days=1)

        assert response.status_code == 504
        assert response.json()["detail"] == occ.TIMEOUT_DETAIL

    def test_payload_without_a_candle_list_is_not_reported_as_no_trades(self, client, upstream):
        upstream(FakeUpstox(intraday={"status": "success", "data": {}}))
        response = _get(client, days=1)

        assert response.status_code == 502
        assert response.json()["detail"] == occ.UNAVAILABLE_DETAIL

    def test_error_status_payload_is_not_served_as_an_empty_series(self, client, upstream):
        upstream(FakeUpstox(intraday={"status": "error", "data": {"candles": []}}))
        response = _get(client, days=1)

        assert response.status_code == 502
        assert response.json()["detail"] == occ.UNAVAILABLE_DETAIL


class TestCache:
    def test_second_request_is_served_from_cache(self, client, upstream):
        fake = upstream(FakeUpstox(intraday=_payload([_bar("2026-11-17T09:15:00+05:30")])))

        first = _get(client, days=1).json()
        second = _get(client, days=1).json()

        assert len(fake.calls) == 1
        assert first["cached"] is False
        assert second["cached"] is True
        assert second["candles"] == first["candles"]

    def test_cache_entries_are_separated_by_interval(self, client, upstream):
        fake = upstream(FakeUpstox(intraday=_payload([_bar("2026-11-17T09:15:00+05:30")])))

        _get(client, interval="1m", days=1)
        _get(client, interval="5m", days=1)
        _get(client, interval="1m", days=1)

        assert len(fake.calls) == 2
        assert fake.calls[1].endswith("/minutes/5")

    def test_source_and_cached_flags_are_reported_on_a_cache_hit(self, client, upstream):
        upstream(FakeUpstox())
        _get(client, days=1)
        body = _get(client, days=1).json()

        assert body["source"] == "upstox"
        assert body["cached"] is True
        assert body["empty_reason"] == "no_trades"

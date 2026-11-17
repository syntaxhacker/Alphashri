"""``GET /api/options/chain`` — quote freshness, strike levels, IV validity.

A chain consumer must be able to tell live prints from last session's, read
walls/max pain/GEX from one cached object, and ignore absurd IVs (117) while
still displaying the raw value.
"""

import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api import options as op  # noqa: E402
from api import options_underlying as ou  # noqa: E402

EXPIRY = "2026-03-17"
CE_OI = [1000, 2000, 4000, 8000, 16000, 12000, 9000, 6000, 3000, 1500, 500]
PE_OI = [500, 1500, 3000, 6000, 9000, 12000, 16000, 8000, 4000, 2000, 1000]
STRIKES = [24750 + 50 * i for i in range(len(CE_OI))]


def _leg(side: str, oi: int, *, iv=15.0, gamma=0.01, ltp=100.0, greeks=True) -> dict:
    leg = {
        "instrument_key": f"NSE_FO|{side}{oi}",
        "trading_symbol": f"NIFTY26MAR{side}{oi}",
        "expiry": EXPIRY,
        "market_data": {
            "ltp": ltp, "volume": 1000, "oi": oi, "prev_oi": oi // 2,
            "bid_price": ltp - 1, "ask_price": ltp + 1, "close_price": ltp - 1,
        },
    }
    if greeks:
        leg["option_greeks"] = {
            "delta": 0.5 if side == "CE" else -0.5,
            "gamma": gamma, "vega": 10, "theta": -2, "iv": iv,
        }
    return leg


def _payload(*, spot: float = 25000.0, with_greeks: bool = True) -> dict:
    rows = [
        {
            "strike_price": strike,
            "pcr": 1.0,
            "call_options": _leg("CE", ce_oi, greeks=with_greeks),
            "put_options": _leg("PE", pe_oi, greeks=with_greeks),
        }
        for strike, ce_oi, pe_oi in zip(STRIKES, CE_OI, PE_OI)
    ]
    return {"status": "success", "underlying_spot_price": spot, "data": rows}


@pytest.fixture(autouse=True)
def _reset_module_state():
    op.clear_option_chain_cache()
    ou._cache.clear()
    ou._locks.clear()
    yield
    op.clear_option_chain_cache()
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
    def install(payload=None):
        payload = payload or _payload()

        async def fake(endpoint, params=None):
            assert endpoint == "/option/chain"
            return payload

        monkeypatch.setattr(op, "fetch_upstox", fake)
        return fake

    return install


def _get(client, **extra):
    return client.get("/api/options/chain/NIFTY", params={"expiry": EXPIRY, **extra})


class TestFreshnessFields:
    def test_open_payload_carries_freshness_and_levels_contract(self, client, upstream):
        upstream()
        body = _get(client).json()

        assert body["market_state"] == "open"
        assert body["quotes_live"] is True
        assert body["session_date"] == "2026-11-16"
        assert body["data_as_of"] == body["timestamp"]

        levels = body["levels"]
        for key in ("spot", "step", "thin", "call_wall", "put_wall",
                    "call_walls", "put_walls", "max_pain", "gex"):
            assert key in levels, key
        for key in ("support", "resistance", "fuel_down", "fuel_up",
                    "flip", "regime", "degraded"):
            assert key in levels["gex"], key
        assert levels["thin"] is False
        assert levels["max_pain"] is not None
        assert body["summary"]["max_pain"] == levels["max_pain"]["strike"]

    def test_closed_chain_is_marked_not_live(self, client, upstream, frozen):
        upstream()
        frozen(now=ou.datetime(2026, 11, 16, 18, 0, tzinfo=ou.config.IST), cash_open=False)
        body = _get(client).json()

        assert body["market_state"] == "closed"
        assert body["quotes_live"] is False
        assert body["session_date"] == "2026-11-16"
        assert body["session_date"] in body["data_as_of"]
        assert "not live" in body["data_as_of"]
        assert body["levels"]["max_pain"] is not None

    def test_preopen_chain_points_to_previous_session(self, client, upstream, frozen):
        upstream()
        frozen(now=ou.datetime(2026, 11, 16, 9, 5, tzinfo=ou.config.IST), cash_open=False)
        body = _get(client).json()

        assert body["market_state"] == "pre_open"
        assert body["quotes_live"] is False
        assert body["session_date"] == "2026-11-13"  # Friday

    def test_weekend_chain_points_to_last_trading_day(self, client, upstream, frozen):
        upstream()
        frozen(now=ou.datetime(2026, 11, 21, 11, 0, tzinfo=ou.config.IST), cash_open=False)
        body = _get(client).json()

        assert body["market_state"] == "closed"
        assert body["quotes_live"] is False
        assert body["session_date"] == "2026-11-20"  # Friday


class TestLevelsNullRules:
    def test_empty_chain_nulls_every_level(self, client, upstream):
        payload = _payload()
        payload["data"] = []
        upstream(payload)
        body = _get(client).json()
        levels = body["levels"]

        assert levels["thin"] is True
        assert levels["step"] is None
        assert levels["call_wall"] is None
        assert levels["put_wall"] is None
        assert levels["call_walls"] == []
        assert levels["put_walls"] == []
        assert levels["max_pain"] is None
        assert levels["gex"]["degraded"] is True
        assert levels["gex"]["regime"] == "flat"
        for key in ("support", "resistance", "fuel_down", "fuel_up", "flip"):
            assert levels["gex"][key] is None
        assert body["summary"]["max_pain"] == 0

    def test_thin_chain_is_flagged(self, client, upstream):
        payload = _payload()
        payload["data"] = payload["data"][:2]
        upstream(payload)
        assert _get(client).json()["levels"]["thin"] is True

    def test_missing_gamma_degrades_gex_but_keeps_walls_and_max_pain(self, client, upstream):
        upstream(_payload(with_greeks=False))
        levels = _get(client).json()["levels"]

        assert levels["thin"] is False
        assert levels["call_wall"] is not None
        assert levels["put_wall"] is not None
        assert levels["max_pain"] is not None
        assert levels["gex"]["degraded"] is True
        for key in ("support", "resistance", "fuel_down", "fuel_up", "flip"):
            assert levels["gex"][key] is None

    def test_levels_max_pain_matches_brute_force(self, client, upstream):
        upstream()
        body = _get(client).json()
        rows = [
            {
                "strike": r["strike"],
                "ce_oi": r["ce"]["market_data"]["oi"],
                "pe_oi": r["pe"]["market_data"]["oi"],
            }
            for r in body["chain"]
        ]

        def loss(test_strike):
            total = 0
            for row in rows:
                if test_strike > row["strike"]:
                    total += (test_strike - row["strike"]) * row["ce_oi"]
                elif test_strike < row["strike"]:
                    total += (row["strike"] - test_strike) * row["pe_oi"]
            return total

        expected = min((r["strike"] for r in rows), key=lambda s: (loss(s), s))
        assert body["levels"]["max_pain"]["strike"] == expected
        assert body["summary"]["max_pain"] == expected


class TestIvValidity:
    @pytest.mark.parametrize("iv,expected", [
        (20.0, True),
        (60.0, True),
        (80.0, True),
        (100.0, True),
        (0, False),
        (117.0, False),
        (100.1, False),
        (float("nan"), False),
        (float("inf"), False),
    ])
    def test_iv_valid_flag(self, iv, expected):
        raw = {
            "market_data": {"ltp": 100},
            "option_greeks": {"delta": 0.5, "gamma": 0.01, "iv": iv},
        }
        leg = op.transform_option_contract(raw, 25000, "CE")
        assert leg["iv_valid"] is expected
        assert leg["option_greeks"]["iv_valid"] is expected
        assert leg["option_greeks"]["iv"] == iv or (
            isinstance(iv, float) and iv != iv  # NaN preserved as-is
        )

    def test_missing_iv_is_invalid_without_fabricating_a_value(self):
        raw = {"market_data": {"ltp": 100}, "option_greeks": {"delta": 0.5}}
        leg = op.transform_option_contract(raw, 25000, "CE")
        assert leg["iv_valid"] is False
        assert leg["option_greeks"]["iv_valid"] is False
        assert leg["option_greeks"]["iv"] == 0

    def test_absurd_iv_survives_in_chain_payload_with_invalid_flag(self, client, upstream):
        payload = _payload()
        payload["data"][0]["call_options"]["option_greeks"]["iv"] = 117
        upstream(payload)
        leg = _get(client).json()["chain"][0]["ce"]

        assert leg["option_greeks"]["iv"] == 117
        assert leg["iv_valid"] is False
        assert leg["option_greeks"]["iv_valid"] is False


class TestLevelsTravelInCache:
    def test_cache_hit_returns_identical_levels_and_freshness(self, client, upstream, frozen):
        upstream()
        first = _get(client).json()

        ou._now = lambda: ou.datetime(2026, 11, 16, 10, 31, tzinfo=ou.config.IST)
        second = _get(client).json()

        for key in ("timestamp", "data_as_of", "levels", "market_state",
                    "quotes_live", "session_date"):
            assert second[key] == first[key], key

"""
Tests for the Fyers bridge API endpoints (``/api/fyers-bridge/*``).

Proxy endpoints for Fyers v3 option-chain and history data used by the screener.
All Fyers SDK calls (``fyers_apiv3.fyersModel.FyersModel``) and token resolution
(``api.fyers_bridge.recorder_token``) are mocked so tests run without network
or real credentials.

Contract tested:
- GET /expiries?symbol=...        -> {"expiries": [YYYY-MM-DD, ...]} (ascending)
- GET /chain?symbol=...&expiry=.. -> {"expiry", "at", "spot", "strikes": [{strike, call, put}]}
- GET /futures?symbol=...         -> {"date", "prevClose", "prevOi", "candles": [{at, close, oi}]}
- Times are epoch ms (ints), never ISO strings.
- Missing Fyers token -> empty lists, HTTP 200 (never 500).
"""

import sys
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.fyers_bridge import router  # noqa: E402


# ---------------------------------------------------------------------------
# Test app: mount the bridge router (router already carries its own prefix).
# ---------------------------------------------------------------------------
_app = FastAPI()
_app.include_router(router)
_client = TestClient(_app)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fyers_model(optionchain=None, history=None):
    """Build a mocked FyersModel whose optionchain/history return fixed payloads."""
    model = MagicMock()
    model.optionchain = MagicMock(
        return_value=optionchain if optionchain is not None else {"s": "ok", "data": {}}
    )
    model.history = MagicMock(
        return_value=history if history is not None else {"s": "ok", "candles": []}
    )
    return model


def _bridge_ctx(token="APP123:ACCESS_TOKEN", optionchain=None, history=None):
    """Patch recorder_token + FyersModel together, returning a context manager."""
    model = _fyers_model(optionchain=optionchain, history=history)
    stack = ExitStack()
    stack.enter_context(patch("api.fyers_bridge.recorder_token", return_value=token))
    stack.enter_context(patch("fyers_apiv3.fyersModel.FyersModel", return_value=model))
    # Clear the per-process client cache so the patched model is used, not a
    # cached instance from a previous test.
    import api.fyers_bridge as _fb
    _fb._fyers_client_cache.clear()
    return stack


# Fyers optionchain uses DD-MM-YYYY expiry dates (see api/fyers_options.py).
OPTIONCHAIN_WITH_EXPIRIES = {
    "s": "ok",
    "data": {
        "expiryData": [
            {"date": "24-09-2026"},
            {"date": "01-10-2026"},
            {"date": "08-10-2026"},
        ],
        "optionsChain": [],
    },
}

OPTIONCHAIN_WITH_LEGS = {
    "s": "ok",
    "data": {
        "expiryData": [{"date": "24-09-2026"}],
        "optionsChain": [
            {
                "strike_price": 23000,
                "option_type": "CE",
                "symbol": "NSE:NIFTY26SEP23000CE",
                "fyToken": "1001",
                "ltp": 150.5,
                "oi": 10000,
                "prev_oi": 9500,
                "volume": 500,
                "bid": 150.0,
                "ask": 151.0,
                "delta": 0.5,
            },
            {
                "strike_price": 23000,
                "option_type": "PE",
                "symbol": "NSE:NIFTY26SEP23000PE",
                "fyToken": "1002",
                "ltp": 100.0,
                "oi": 8000,
                "prev_oi": 7500,
                "volume": 300,
                "bid": 99.0,
                "ask": 101.0,
                "delta": -0.5,
            },
            {
                "strike_price": 23100,
                "option_type": "CE",
                "symbol": "NSE:NIFTY26SEP23100CE",
                "fyToken": "1003",
                "ltp": 80.0,
                "oi": 6000,
                "prev_oi": 5800,
                "volume": 200,
                "bid": 79.5,
                "ask": 80.5,
                "delta": 0.3,
            },
            {
                "strike_price": 23100,
                "option_type": "PE",
                "symbol": "NSE:NIFTY26SEP23100PE",
                "fyToken": "1004",
                "ltp": 120.0,
                "oi": 9000,
                "prev_oi": 8800,
                "volume": 400,
                "bid": 119.0,
                "ask": 121.0,
                "delta": -0.3,
            },
        ],
    },
}

HISTORY_WITH_CANDLES = {
    "s": "ok",
    "candles": [
        [1758660000000, 2340.0, 2355.0, 2330.0, 2350.0, 50000, 51000],
        [1758660060000, 2350.0, 2360.0, 2345.0, 2355.0, 52000, 51500],
        [1758660120000, 2355.0, 2365.0, 2350.0, 2360.0, 54000, 52000],
    ],
}


# ---------------------------------------------------------------------------
# 1. Router import
# ---------------------------------------------------------------------------

def test_router_imports():
    """The bridge router must be importable as ``from api.fyers_bridge import router``."""
    from api.fyers_bridge import router as imported_router  # noqa: F811
    assert imported_router is not None


# ---------------------------------------------------------------------------
# 2. Expiries endpoint shape
# ---------------------------------------------------------------------------

def test_expiries_endpoint_shape():
    """Expiries returns {"expiries": [...]} with YYYY-MM-DD dates in ascending order."""
    with _bridge_ctx(optionchain=OPTIONCHAIN_WITH_EXPIRIES):
        response = _client.get(
            "/api/fyers-bridge/expiries", params={"symbol": "NSE:NIFTY50-INDEX"}
        )
    assert response.status_code == 200
    data = response.json()
    assert set(data.keys()) == {"expiries"}
    expiries = data["expiries"]
    assert isinstance(expiries, list)
    assert expiries == ["2026-09-24", "2026-10-01", "2026-10-08"]
    # Ascending order and strict YYYY-MM-DD format.
    assert expiries == sorted(expiries)
    for d in expiries:
        assert len(d) == 10
        assert d[4] == "-" and d[7] == "-"


def test_expiries_empty_when_no_expiry_data():
    """Missing expiryData in Fyers response yields an empty expiries list."""
    with _bridge_ctx(optionchain={"s": "ok", "data": {}}):
        response = _client.get(
            "/api/fyers-bridge/expiries", params={"symbol": "NSE:NIFTY50-INDEX"}
        )
    assert response.status_code == 200
    assert response.json() == {"expiries": []}


# ---------------------------------------------------------------------------
# 3. Chain endpoint shape
# ---------------------------------------------------------------------------

def test_chain_endpoint_shape():
    """Chain returns {expiry, at, spot, strikes:[{strike, call, put}]} with full leg fields."""
    with _bridge_ctx(optionchain=OPTIONCHAIN_WITH_LEGS):
        response = _client.get(
            "/api/fyers-bridge/chain",
            params={"symbol": "NSE:NIFTY50-INDEX", "expiry": "2026-09-24"},
        )
    assert response.status_code == 200
    data = response.json()

    # Top-level keys.
    assert set(data.keys()) == {"expiry", "at", "spot", "prevClose", "strikes"}
    assert data["expiry"] == "2026-09-24"
    # `at` is epoch ms (int), never an ISO string.
    assert isinstance(data["at"], int)
    assert data["at"] > 1_000_000_000_000
    assert isinstance(data["spot"], (int, float))

    strikes = data["strikes"]
    assert isinstance(strikes, list)
    assert len(strikes) == 2

    for strike_entry in strikes:
        assert set(strike_entry.keys()) == {"strike", "call", "put"}
        assert isinstance(strike_entry["strike"], (int, float))

        for leg in ("call", "put"):
            leg_data = strike_entry[leg]
            assert isinstance(leg_data, dict)
            for field in ("ltp", "oi", "prevOi", "volume", "bid", "ask", "delta"):
                assert field in leg_data, f"missing {field} in {leg} leg"
            assert isinstance(leg_data["ltp"], (int, float))
            assert isinstance(leg_data["oi"], (int, float))
            assert isinstance(leg_data["prevOi"], (int, float))
            assert isinstance(leg_data["volume"], (int, float))
            assert isinstance(leg_data["bid"], (int, float))
            assert isinstance(leg_data["ask"], (int, float))
            assert isinstance(leg_data["delta"], (int, float))

    # Strikes should be ordered.
    strike_values = [s["strike"] for s in strikes]
    assert strike_values == sorted(strike_values)


def test_chain_empty_strikes_when_no_legs():
    """Empty optionsChain yields an empty strikes list."""
    with _bridge_ctx(optionchain={"s": "ok", "data": {"expiryData": [], "optionsChain": []}}):
        response = _client.get(
            "/api/fyers-bridge/chain",
            params={"symbol": "NSE:NIFTY50-INDEX", "expiry": "2026-09-24"},
        )
    assert response.status_code == 200
    data = response.json()
    assert data["strikes"] == []


# ---------------------------------------------------------------------------
# 4. Futures endpoint shape
# ---------------------------------------------------------------------------

def test_futures_endpoint_shape():
    """Futures returns {date, prevClose, prevOi, candles:[{at, close, oi}]} ascending."""
    with _bridge_ctx(history=HISTORY_WITH_CANDLES):
        response = _client.get(
            "/api/fyers-bridge/futures", params={"symbol": "NSE:RELIANCE26SEPFUT"}
        )
    assert response.status_code == 200
    data = response.json()

    # Top-level keys.
    assert set(data.keys()) == {"date", "prevClose", "prevOi", "candles"}
    assert isinstance(data["date"], str)
    assert len(data["date"]) == 10  # YYYY-MM-DD
    assert isinstance(data["prevClose"], (int, float))
    assert isinstance(data["prevOi"], (int, float))

    candles = data["candles"]
    assert isinstance(candles, list)
    assert len(candles) == 3

    for candle in candles:
        assert set(candle.keys()) == {"at", "close", "oi"}
        # `at` is epoch ms (int), never an ISO string.
        assert isinstance(candle["at"], int)
        assert candle["at"] > 1_000_000_000_000
        assert isinstance(candle["close"], (int, float))
        assert isinstance(candle["oi"], (int, float))

    # Candles ascending by time.
    times = [c["at"] for c in candles]
    assert times == sorted(times)


def test_futures_empty_candles():
    """Empty history candles yields an empty candles list."""
    with _bridge_ctx(history={"s": "ok", "candles": []}):
        response = _client.get(
            "/api/fyers-bridge/futures", params={"symbol": "NSE:RELIANCE26SEPFUT"}
        )
    assert response.status_code == 200
    data = response.json()
    assert data["candles"] == []


# ---------------------------------------------------------------------------
# 5. Time normalization to epoch ms
# ---------------------------------------------------------------------------

def test_normalizes_times_to_epoch_ms():
    """`at` / candle.at are epoch-ms ints, not ISO strings."""
    with _bridge_ctx(optionchain=OPTIONCHAIN_WITH_LEGS, history=HISTORY_WITH_CANDLES):
        chain_resp = _client.get(
            "/api/fyers-bridge/chain",
            params={"symbol": "NSE:NIFTY50-INDEX", "expiry": "2026-09-24"},
        )
        futures_resp = _client.get(
            "/api/fyers-bridge/futures", params={"symbol": "NSE:RELIANCE26SEPFUT"}
        )

    assert chain_resp.status_code == 200
    assert futures_resp.status_code == 200

    chain_data = chain_resp.json()
    assert isinstance(chain_data["at"], int)
    assert not isinstance(chain_data["at"], str)

    for candle in futures_resp.json()["candles"]:
        assert isinstance(candle["at"], int)
        assert not isinstance(candle["at"], str)


# ---------------------------------------------------------------------------
# 6. Missing token returns empty, not 500
# ---------------------------------------------------------------------------

def test_missing_token_expiries_returns_empty():
    """With no Fyers token configured, /expiries returns {"expiries": []} with 200."""
    with _bridge_ctx(token=None):
        response = _client.get(
            "/api/fyers-bridge/expiries", params={"symbol": "NSE:NIFTY50-INDEX"}
        )
    assert response.status_code == 200
    assert response.json() == {"expiries": []}


def test_missing_token_chain_returns_empty():
    """With no Fyers token configured, /chain returns an empty strikes list with 200."""
    with _bridge_ctx(token=None):
        response = _client.get(
            "/api/fyers-bridge/chain",
            params={"symbol": "NSE:NIFTY50-INDEX", "expiry": "2026-09-24"},
        )
    assert response.status_code == 200
    data = response.json()
    assert data["strikes"] == []


def test_missing_token_futures_returns_empty():
    """With no Fyers token configured, /futures returns an empty candles list with 200."""
    with _bridge_ctx(token=None):
        response = _client.get(
            "/api/fyers-bridge/futures", params={"symbol": "NSE:RELIANCE26SEPFUT"}
        )
    assert response.status_code == 200
    data = response.json()
    assert data["candles"] == []

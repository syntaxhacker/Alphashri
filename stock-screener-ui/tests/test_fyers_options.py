"""Tests for the Fyers option-symbol resolver (api/fyers_options.py) and the
GET /api/options/fyers-symbol endpoint."""

import sys
import types

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import fyers_options
from api.fyers_options import (
    clear_fyers_chain_cache,
    fyers_underlying_symbol,
    resolve_fyers_option_symbol,
)


EXPIRY_ISO = "2026-09-30"
EXPIRY_FYERS = "30-09-2026"


def _chain():
    return {
        "expiryData": [
            {"date": EXPIRY_FYERS, "expiry": 1790000000, "expiry_flag": "1"},
            {"date": "07-10-2026", "expiry": 1790600000, "expiry_flag": "0"},
        ],
        "optionsChain": [
            {
                "symbol": "NSE:NIFTY26SEP23400CE",
                "fyToken": 12345,
                "option_type": "CE",
                "strike_price": 23400,
                "ltp": 10.5,
                "oi": 1000,
                "oich": 50,
            },
            {
                "symbol": "NSE:NIFTY26SEP23400PE",
                "fyToken": 12346,
                "option_type": "PE",
                "strike_price": 23400,
                "ltp": 12.0,
                "oi": 2000,
                "oich": -30,
            },
        ],
    }


@pytest.fixture(autouse=True)
def _clean_cache():
    clear_fyers_chain_cache()
    yield
    clear_fyers_chain_cache()


@pytest.fixture()
def _mock_chain(monkeypatch):
    """Serve the canned chain without touching the network."""
    calls = []

    def fake_fetch(_symbol):
        calls.append(_symbol)
        return _chain()

    monkeypatch.setattr(fyers_options, "_fetch_option_chain", fake_fetch)
    return calls


class TestUnderlyingMapping:
    def test_known_underlyings(self):
        assert fyers_underlying_symbol("NIFTY") == "NSE:NIFTY50-INDEX"
        assert fyers_underlying_symbol("banknifty") == "NSE:NIFTYBANK-INDEX"
        assert fyers_underlying_symbol("SENSEX") == "BSE:SENSEX-INDEX"

    def test_qualified_passthrough(self):
        assert fyers_underlying_symbol("NSE:NIFTY50-INDEX") == "NSE:NIFTY50-INDEX"

    def test_unknown_or_empty(self):
        assert fyers_underlying_symbol("NOPE") is None
        assert fyers_underlying_symbol("") is None
        assert fyers_underlying_symbol(None) is None


class TestResolve:
    def test_found_returns_symbol_and_greeks_free_fields(self, _mock_chain):
        out = resolve_fyers_option_symbol("NIFTY", EXPIRY_ISO, 23400, "CE")
        assert out == {
            "symbol": "NSE:NIFTY26SEP23400CE",
            "fyToken": 12345,
            "oi": 1000,
            "oich": 50,
        }

    def test_option_type_case_insensitive(self, _mock_chain):
        out = resolve_fyers_option_symbol("NIFTY", EXPIRY_ISO, 23400, "pe")
        assert out is not None and out["symbol"] == "NSE:NIFTY26SEP23400PE"

    def test_expiry_mismatch_returns_none(self, _mock_chain):
        assert resolve_fyers_option_symbol("NIFTY", "2026-11-25", 23400, "CE") is None

    def test_strike_not_found_returns_none(self, _mock_chain):
        assert resolve_fyers_option_symbol("NIFTY", EXPIRY_ISO, 99999, "CE") is None

    def test_type_not_found_returns_none(self, _mock_chain, monkeypatch):
        chain = _chain()
        chain["optionsChain"] = [chain["optionsChain"][0]]  # CE only
        monkeypatch.setattr(fyers_options, "_fetch_option_chain", lambda _s: chain)
        assert resolve_fyers_option_symbol("NIFTY", EXPIRY_ISO, 23400, "PE") is None

    def test_bad_inputs_return_none(self, _mock_chain):
        assert resolve_fyers_option_symbol("NIFTY", EXPIRY_ISO, 23400, "XX") is None
        assert resolve_fyers_option_symbol("NIFTY", "30/09/2026", 23400, "CE") is None
        assert resolve_fyers_option_symbol("NOPE", EXPIRY_ISO, 23400, "CE") is None
        assert resolve_fyers_option_symbol("NIFTY", EXPIRY_ISO, "abc", "CE") is None

    def test_fetch_failure_returns_none(self, monkeypatch):
        monkeypatch.setattr(fyers_options, "_fetch_option_chain", lambda _s: None)
        assert resolve_fyers_option_symbol("NIFTY", EXPIRY_ISO, 23400, "CE") is None

    def test_never_raises_on_malformed_chain(self, monkeypatch):
        monkeypatch.setattr(
            fyers_options, "_fetch_option_chain", lambda _s: {"optionsChain": "garbage"}
        )
        assert resolve_fyers_option_symbol("NIFTY", EXPIRY_ISO, 23400, "CE") is None

    def test_cache_hit_avoids_second_fetch(self, _mock_chain):
        first = resolve_fyers_option_symbol("NIFTY", EXPIRY_ISO, 23400, "CE")
        second = resolve_fyers_option_symbol("NIFTY", EXPIRY_ISO, 23400, "PE")
        assert first is not None and second is not None
        assert len(_mock_chain) == 1, "second resolve must reuse the cached chain"

    def test_cache_is_per_expiry(self, _mock_chain):
        resolve_fyers_option_symbol("NIFTY", EXPIRY_ISO, 23400, "CE")
        resolve_fyers_option_symbol("NIFTY", "2026-10-07", 23400, "CE")
        assert len(_mock_chain) == 2


class TestFetch:
    def _install_fake_sdk(self, monkeypatch, response, seen):
        class FakeModel:
            def __init__(self, **kwargs):
                seen.update(kwargs)

            def optionchain(self, data):
                seen["data"] = data
                return response

        pkg = types.ModuleType("fyers_apiv3")
        sub = types.ModuleType("fyers_apiv3.fyersModel")
        sub.FyersModel = FakeModel
        pkg.fyersModel = sub
        monkeypatch.setitem(sys.modules, "fyers_apiv3", pkg)
        monkeypatch.setitem(sys.modules, "fyers_apiv3.fyersModel", sub)

    def test_splits_combined_token_for_fyers_model(self, monkeypatch):
        import api.orderflow_recorder as recorder

        monkeypatch.setattr(recorder, "recorder_token", lambda _b: "APP-100:SECRET-XYZ")
        seen: dict = {}
        self._install_fake_sdk(monkeypatch, {"s": "ok", "data": _chain()}, seen)

        out = fyers_options._fetch_option_chain("NSE:NIFTY50-INDEX")

        assert out == _chain()
        # TOKEN GOTCHA: client_id and token go separately — never combined.
        assert seen["client_id"] == "APP-100"
        assert seen["token"] == "SECRET-XYZ"
        assert seen["data"]["symbol"] == "NSE:NIFTY50-INDEX"

    def test_api_error_returns_none(self, monkeypatch):
        import api.orderflow_recorder as recorder

        monkeypatch.setattr(recorder, "recorder_token", lambda _b: "APP:TOK")
        self._install_fake_sdk(
            monkeypatch, {"s": "error", "code": -15, "message": "bad token"}, {}
        )
        assert fyers_options._fetch_option_chain("NSE:NIFTY50-INDEX") is None

    def test_missing_token_returns_none(self, monkeypatch):
        import api.orderflow_recorder as recorder

        monkeypatch.setattr(recorder, "recorder_token", lambda _b: None)
        assert fyers_options._fetch_option_chain("NSE:NIFTY50-INDEX") is None

    def test_bare_token_without_app_id_returns_none(self, monkeypatch):
        import api.orderflow_recorder as recorder

        monkeypatch.setattr(recorder, "recorder_token", lambda _b: "JUSTATOKEN")
        assert fyers_options._fetch_option_chain("NSE:NIFTY50-INDEX") is None


class TestEndpoint:
    def _client(self):
        from api.options import router

        app = FastAPI()
        app.include_router(router)
        return TestClient(app)

    def test_found_returns_symbol_shape(self, monkeypatch):
        import api.options as options_mod

        monkeypatch.setattr(
            options_mod,
            "resolve_fyers_option_symbol",
            lambda *a: {"symbol": "NSE:NIFTY26SEP23400CE", "fyToken": 1, "oi": 5, "oich": 2},
        )
        res = self._client().get(
            "/api/options/fyers-symbol",
            params={"underlying": "NIFTY", "expiry": EXPIRY_ISO, "strike": 23400, "option_type": "CE"},
        )
        assert res.status_code == 200
        assert res.json() == {
            "symbol": "NSE:NIFTY26SEP23400CE",
            "fyToken": 1,
            "oi": 5,
            "oich": 2,
        }

    def test_missing_contract_is_404(self, monkeypatch):
        import api.options as options_mod

        monkeypatch.setattr(
            options_mod, "resolve_fyers_option_symbol", lambda *a: None
        )
        res = self._client().get(
            "/api/options/fyers-symbol",
            params={"underlying": "NIFTY", "expiry": EXPIRY_ISO, "strike": 1, "option_type": "CE"},
        )
        assert res.status_code == 404

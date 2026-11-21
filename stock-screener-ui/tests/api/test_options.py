"""
Tests for Options API endpoints.

Tests the /api/options endpoints which provide option chain data,
quantitative analysis (Max Pain, Expected Move), and sentiment.

Test cases cover:
- Quantitative utility logic (Sentiment, Expected Move, Max Pain)
- Option chain transformation
- API endpoint structure and responses
"""

import sys
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

# Add project root to path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from api.options import (
    get_option_sentiment, 
    calculate_expected_move, 
    calculate_max_pain,
    transform_option_contract
)


class TestOptionsQuantLogic:
    """
    Test suite for server-side quantitative logic.
    """

    def test_sentiment_logic_all_cases(self):
        """
        Test that sentiment is correctly identified for all Price/OI combinations.
        """
        # Long Buildup: Price Up, OI Up
        assert get_option_sentiment(10.5, 500)["label"] == "LB"
        # Short Buildup: Price Down, OI Up
        assert get_option_sentiment(-5.2, 1000)["label"] == "SB"
        # Short Covering: Price Up, OI Down
        assert get_option_sentiment(8.0, -2000)["label"] == "SC"
        # Long Unwinding: Price Down, OI Down
        assert get_option_sentiment(-3.5, -1500)["label"] == "LU"
        # Neutral: OI change below threshold
        assert get_option_sentiment(100.0, 50)["label"] == "Neutral"

    def test_expected_move_calculation(self):
        """
        Test that Expected Move calculation uses correct time-decay math.
        """
        spot = 20000
        iv = 20
        dte = 7
        result = calculate_expected_move(spot, iv, dte)
        
        assert result is not None
        assert result["upper"] > spot
        assert result["lower"] < spot
        assert result["range"] > 0
        
        # Expected range approx: 20000 * 0.2 * sqrt(7/365) approx 553
        assert 500 < result["range"] < 600

    def test_max_pain_calculation(self):
        """
        Test that Max Pain correctly identifies the strike with minimum loss.
        """
        # Symmetrical distribution: Max Pain should be the middle strike
        strike_matrix = [
            {"strike": 100, "ce": {"market_data": {"oi": 1000}}},
            {"strike": 110, "pe": {"market_data": {"oi": 1000}}}
        ]
        max_pain = calculate_max_pain(strike_matrix)
        assert max_pain in [100, 110]

    def test_contract_transformation(self):
        """
        Test that raw data is transformed into the enriched flattened structure.
        """
        raw_data = {
            "instrument_key": "NSE_FO|123",
            "trading_symbol": "NIFTY26MAR20000CE",
            "market_data": {
                "ltp": 150,
                "oi": 5000,
                "prev_oi": 4000,
                "bid_price": 145
            }
        }
        transformed = transform_option_contract(raw_data, 20000, "CE")

        assert transformed["instrument_type"] == "CE"
        assert transformed["sentiment"]["label"] == "LB"
        assert transformed["strike_price"] == 20000


class TestOptionsChainFieldPassthrough:
    """
    Test that every field Upstox's /option/chain returns is passed through
    (quote depth, prev close, PoP, per-strike PCR).
    """

    def test_transform_passes_quote_depth_fields(self):
        raw_data = {
            "instrument_key": "NSE_FO|123",
            "trading_symbol": "NIFTY26MAR25000CE",
            "expiry": "2026-03-17",
            "market_data": {
                "ltp": 100,
                "volume": 1000,
                "oi": 5000,
                "close_price": 95.5,
                "bid_price": 99,
                "bid_qty": 1125,
                "ask_price": 101,
                "ask_qty": 2150,
                "prev_oi": 4000,
            },
            "option_greeks": {
                "delta": 0.5, "gamma": 0.01, "vega": 10,
                "theta": -2, "iv": 15, "pop": 40.56,
            },
        }
        transformed = transform_option_contract(raw_data, 25000, "CE")

        md = transformed["market_data"]
        assert md["close_price"] == 95.5
        assert md["bid_qty"] == 1125
        assert md["ask_qty"] == 2150
        assert transformed["option_greeks"]["pop"] == 40.56

    def test_transform_defaults_missing_quote_fields(self):
        """Old/cached payloads without the new fields default to 0 (backward compatible)."""
        raw_data = {
            "instrument_key": "NSE_FO|123",
            "trading_symbol": "NIFTY26MAR25000CE",
            "market_data": {"ltp": 100, "oi": 1000, "prev_oi": 500},
            "option_greeks": {"delta": 0.5, "iv": 15},
        }
        transformed = transform_option_contract(raw_data, 25000, "CE")

        md = transformed["market_data"]
        assert md["close_price"] == 0
        assert md["bid_qty"] == 0
        assert md["ask_qty"] == 0
        assert transformed["option_greeks"]["pop"] == 0

    def test_chain_row_carries_per_strike_pcr(self, client: TestClient):
        """Per-strike PCR from Upstox is exposed on each chain row."""
        from unittest.mock import patch, AsyncMock
        mock_data = {
            "status": "success",
            "underlying_spot_price": 25000,
            "data": [
                {
                    "strike_price": 25000,
                    "pcr": 1.25,
                    "call_options": {
                        "instrument_key": "NSE_FO|123",
                        "trading_symbol": "NIFTY26MAR25000CE",
                        "expiry": "2026-03-17",
                        "market_data": {
                            "ltp": 100, "oi": 1000, "prev_oi": 500, "volume": 1000,
                            "bid_price": 99, "bid_qty": 50, "ask_price": 101,
                            "ask_qty": 60, "close_price": 98,
                        },
                        "option_greeks": {"delta": 0.5, "gamma": 0.01, "vega": 10, "theta": -2, "iv": 15, "pop": 40.0},
                    },
                    "put_options": {
                        "instrument_key": "NSE_FO|124",
                        "trading_symbol": "NIFTY26MAR25000PE",
                        "expiry": "2026-03-17",
                        "market_data": {"ltp": 100, "oi": 1250, "prev_oi": 500, "volume": 1000, "bid_price": 99, "ask_price": 101},
                        "option_greeks": {"delta": -0.5, "gamma": 0.01, "vega": 10, "theta": -2, "iv": 15},
                    },
                }
            ],
        }
        with patch("api.options.fetch_upstox", new_callable=AsyncMock, return_value=mock_data):
            response = client.get("/api/options/chain/NIFTY?expiry=2026-03-17")
            assert response.status_code == 200
            data = response.json()
            assert data["chain"][0]["pcr"] == 1.25
            ce_md = data["chain"][0]["ce"]["market_data"]
            assert ce_md["close_price"] == 98
            assert ce_md["bid_qty"] == 50
            assert ce_md["ask_qty"] == 60
            assert data["chain"][0]["ce"]["option_greeks"]["pop"] == 40.0
            # Existing fields untouched
            assert ce_md["ltp"] == 100
            assert ce_md["oi"] == 1000


class TestOptionsEndpoints:
    """
    Test suite for Options API endpoints (Integration).
    """

    def test_get_underlyings(self, client: TestClient):
        """
        Test retrieving list of available indices.
        """
        response = client.get("/api/options/underlyings")
        assert response.status_code == 200
        data = response.json()
        assert "underlyings" in data
        assert any(u["symbol"] == "NIFTY" for u in data["underlyings"])

    def test_get_expiries(self, client: TestClient):
        """
        Test retrieving expiry dates for NIFTY.
        """
        # Use /api/options/expiries prefix if configured
        response = client.get("/api/options/expiries/NIFTY")
        assert response.status_code == 200
        data = response.json()
        assert "expiries" in data
        assert "underlying" in data

    def test_get_option_chain_structure(self, client: TestClient):
        """
        Test that the option chain response has the correct summary fields.
        Uses mocked Upstox response — no live API or pytest.skip.
        """
        from unittest.mock import patch, AsyncMock
        mock_data = {
            "status": "success",
            "underlying_spot_price": 25000,
            "data": [
                {
                    "strike_price": 25000,
                    "call_options": {
                        "instrument_key": "NSE_FO|123",
                        "trading_symbol": "NIFTY26MAR25000CE",
                        "expiry": "2026-03-17",
                        "market_data": {"ltp": 100, "oi": 1000, "prev_oi": 500, "volume": 1000, "bid_price": 99, "ask_price": 101},
                        "option_greeks": {"delta": 0.5, "gamma": 0.01, "vega": 10, "theta": -2, "iv": 15}
                    },
                    "put_options": {
                        "instrument_key": "NSE_FO|124",
                        "trading_symbol": "NIFTY26MAR25000PE",
                        "expiry": "2026-03-17",
                        "market_data": {"ltp": 100, "oi": 1000, "prev_oi": 500, "volume": 1000, "bid_price": 99, "ask_price": 101},
                        "option_greeks": {"delta": -0.5, "gamma": 0.01, "vega": 10, "theta": -2, "iv": 15}
                    }
                }
            ]
        }
        with patch("api.options.fetch_upstox", new_callable=AsyncMock, return_value=mock_data):
            response = client.get("/api/options/chain/NIFTY?expiry=2026-03-17")
            assert response.status_code == 200
            data = response.json()
            assert "summary" in data
            summary = data["summary"]
            assert "pcr" in summary
            assert "max_pain" in summary
            assert "expected_move" in summary


class TestChainResponseContract:
    """Key/type guard for the dock's fresh chain payload.

    A stale API process served ``/chain`` without the freshness fields or the
    ``levels`` block. Asserting the shape (never live numbers) makes such a
    regression fail CI with no network or live Upstox data involved.
    """

    @staticmethod
    def _mock_chain(expiry: str) -> dict:
        """Upstox /option/chain-shaped payload; one leg has an invalid IV."""

        def leg(iv: float, oi: int, suffix: str) -> dict:
            return {
                "instrument_key": f"NSE_FO|{suffix}",
                "trading_symbol": f"INOXWIND{suffix}",
                "expiry": expiry,
                "market_data": {
                    "ltp": 100.0, "oi": oi, "prev_oi": oi, "volume": 1_000,
                    "bid_price": 99.0, "ask_price": 101.0, "close_price": 99.5,
                },
                "option_greeks": {
                    "delta": 0.5, "gamma": 0.001, "vega": 10.0,
                    "theta": -2.0, "iv": iv, "pop": 40.0,
                },
            }

        rows = []
        for strike, ce_oi, pe_oi, ce_iv, pe_iv in (
            (24900, 1_000, 1_500, 15.0, 14.0),
            (25000, 2_000, 2_500, 16.0, 0.0),
            (25100, 1_500, 1_800, 17.0, 13.0),
        ):
            rows.append({
                "strike_price": strike,
                "pcr": 1.0,
                "call_options": leg(ce_iv, ce_oi, f"{strike}CE"),
                "put_options": leg(pe_iv, pe_oi, f"{strike}PE"),
            })
        return {"status": "success", "underlying_spot_price": 25_000, "data": rows}

    def test_chain_response_freshness_levels_iv_valid_and_max_pain_source(
        self, client: TestClient, monkeypatch
    ):
        from datetime import datetime, timedelta
        from unittest.mock import AsyncMock, patch

        import config

        expiry = (datetime.now(config.IST).date() + timedelta(days=10)).isoformat()
        # Avoid the 56 MB instrument master load; the stale incident used this symbol.
        monkeypatch.setattr("api.options.get_instrument_key", lambda s: "NSE_EQ|INE0STUB")
        with patch("api.options.fetch_upstox", new_callable=AsyncMock,
                   return_value=self._mock_chain(expiry)):
            response = client.get(
                f"/api/options/chain/INOXWIND?expiry={expiry}&refresh=true"
            )

        assert response.status_code == 200
        data = response.json()

        # Freshness fields the stale process dropped.
        assert data.get("market_state") in {"open", "closed", "pre_open"}
        assert isinstance(data.get("quotes_live"), bool)
        assert isinstance(data.get("session_date"), str) and len(data["session_date"]) == 10
        assert isinstance(data.get("data_as_of"), str) and bool(data["data_as_of"])

        # Levels block — snake_case on the wire; the dock maps it to camelCase.
        levels = data.get("levels")
        assert isinstance(levels, dict)
        assert {"spot", "step", "thin", "call_wall", "put_wall", "call_walls",
                "put_walls", "max_pain", "gex"} <= levels.keys()
        gex = levels["gex"]
        assert isinstance(gex, dict)
        assert {"support", "resistance", "fuel_down", "fuel_up", "flip",
                "regime", "degraded"} <= gex.keys()
        # A level is either a labelled dict or null — never 0/{} (null allowed).
        for key in ("call_wall", "put_wall", "max_pain"):
            assert levels[key] is None or isinstance(levels[key], dict)
        for key in ("support", "resistance"):
            assert gex[key] is None or isinstance(gex[key], dict)

        # Per-leg IV validity: present on every leg, and computed (both values
        # occur in the mocked chain) rather than hardcoded true.
        flags = []
        for row in data["chain"]:
            for side in ("ce", "pe"):
                leg = row[side]
                assert isinstance(leg.get("iv_valid"), bool), (row["strike"], side)
                flags.append(leg["iv_valid"])
                greeks = leg.get("option_greeks")
                if greeks is not None:
                    assert isinstance(greeks.get("iv_valid"), bool)
        assert True in flags and False in flags

        # summary.max_pain is sourced from levels.max_pain.strike, never
        # recomputed with a different convention (rounding, abs, ...).
        pain = levels["max_pain"]
        assert pain is not None and "strike" in pain
        assert data["summary"]["max_pain"] == pain["strike"]

    def test_dock_expiry_list_contract(self, auth_client: TestClient, monkeypatch):
        """The dock's expiry selector reads /api/options/underlying/{symbol}.expiries.

        The chain response itself has no expiry list; E1 owns it. Each entry must
        carry date/weekly/dte_days/lot_size/tick_size — a stale build returning
        bare date strings would fail this.
        """
        from datetime import datetime, timedelta

        from api import options_underlying as ou

        base = datetime.now(ou.config.IST).date()
        dates = [(base + timedelta(days=n)).isoformat() for n in (10, 30)]

        async def fake_fetch(endpoint, params=None):
            if endpoint == "/option/contract":
                return {
                    "status": "success",
                    "data": [
                        {"expiry": d, "weekly": i == 0, "lot_size": 65,
                         "tick_size": 5.0, "instrument_type": "CE"}
                        for i, d in enumerate(dates)
                    ],
                }
            if endpoint == "/market-quote/ltp":
                return {"status": "success", "data": {
                    "NSE_INDEX|Nifty 50": {
                        "last_price": 25_000,
                        "instrument_token": "NSE_INDEX|Nifty 50",
                    }
                }}
            raise AssertionError(f"unexpected endpoint {endpoint}")

        monkeypatch.setattr(ou, "fetch_upstox", fake_fetch)
        response = auth_client.get("/api/options/underlying/NIFTY")

        assert response.status_code == 200
        expiries = response.json()["expiries"]
        assert isinstance(expiries, list) and expiries
        for entry in expiries:
            assert isinstance(entry["date"], str)
            assert isinstance(entry["weekly"], bool)
            assert isinstance(entry["dte_days"], int)
            assert isinstance(entry["lot_size"], int)
            assert isinstance(entry["tick_size"], (int, float))

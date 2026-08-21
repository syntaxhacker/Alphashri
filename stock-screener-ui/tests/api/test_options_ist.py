"""Verify options.py uses config.IST and mocked UpstoxAPI (no pytest.skip)."""
import sys
from pathlib import Path
from datetime import datetime
from unittest.mock import patch, MagicMock, AsyncMock

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import config
from fastapi.testclient import TestClient
from api_server_fastapi import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


class TestOptionsIST:
    def test_naive_datetime_fixed(self):
        text = Path(ROOT / "api" / "options.py").read_text()
        # Should use config.IST for expiry calc and timestamp
        assert "datetime.now(config.IST)" in text
        # No bare datetime.now() without tz in expiry logic
        assert "expiry_date - datetime.now()" not in text
        assert "datetime.now()).days" not in text

    def test_option_chain_mocked_upstox(self, client):
        # Mock Upstox chain data instead of skipping
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
            r = client.get("/api/options/chain/NIFTY?expiry=2026-03-17")
            assert r.status_code == 200
            data = r.json()
            assert "summary" in data
            assert "pcr" in data["summary"]
            assert "max_pain" in data["summary"]
            assert "expected_move" in data["summary"]
            # ensure no pytest.skip path
            assert data["spot"] == 25000

    def test_options_underlyings_still_works(self, client):
        r = client.get("/api/options/underlyings")
        assert r.status_code == 200

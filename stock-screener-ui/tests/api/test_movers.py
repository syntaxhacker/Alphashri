"""Tests for the index movers endpoint."""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi.testclient import TestClient

# Ensure repo root is on path
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from api.reports_api.movers import (
    NIFTY50_SYMBOLS,
    NIFTY50_WEIGHTS,
    _build_rows,
    _compute_contribution,
    _fetch_quotes,
    _select_index_constituents,
    router,
)


class TestConstituents:
    """Test that constituent lists and weights are well-formed."""

    def test_nifty50_symbols_count(self):
        assert len(NIFTY50_SYMBOLS) == 50
        assert len(NIFTY50_WEIGHTS) == 50
        assert set(NIFTY50_SYMBOLS) == set(NIFTY50_WEIGHTS.keys())

    def test_nifty50_weights_sum_approx_100(self):
        total = sum(NIFTY50_WEIGHTS.values())
        assert 99.0 <= total <= 101.0, f"NIFTY50 weights sum to {total}, expected ~100"

    def test_select_index_constituents_nifty(self):
        symbols, weights, source = _select_index_constituents("NIFTY")
        assert symbols == NIFTY50_SYMBOLS
        assert weights == NIFTY50_WEIGHTS
        assert "NIFTY50" in source

    def test_select_index_constituents_sensex(self):
        symbols, weights, source = _select_index_constituents("SENSEX")
        # SENSEX has 30 symbols but no weights (empty dict)
        assert len(symbols) == 30
        assert weights == {}
        assert "SENSEX" in source
        # Verify TATAMOTORS is NOT in the list (demerged)
        assert "TATAMOTORS" not in symbols
        # Verify TMPV is included (current NSE symbol)
        assert "TMPV" in symbols

    def test_select_index_constituents_invalid(self):
        with pytest.raises(ValueError):
            _select_index_constituents("INVALID")


class TestComputeContribution:
    """Test contribution calculation."""

    def test_positive_change(self):
        # weight 10%, change +2% -> contribution = 10 * 2 / 100 = 0.2
        assert _compute_contribution(2.0, 10.0) == 0.2

    def test_negative_change(self):
        # weight 5%, change -1.5% -> contribution = 5 * (-1.5) / 100 = -0.075
        assert _compute_contribution(-1.5, 5.0) == -0.075

    def test_zero_change(self):
        assert _compute_contribution(0.0, 10.0) == 0.0

    def test_zero_weight(self):
        assert _compute_contribution(2.0, 0.0) == 0.0


class TestBuildRows:
    """Test row building from quotes and weights."""

    def test_build_rows_basic(self):
        symbols = ["HDFCBANK", "ICICIBANK", "RELIANCE"]
        weights = {"HDFCBANK": 10.0, "ICICIBANK": 8.0, "RELIANCE": 7.0}
        quotes = {
            "HDFCBANK": {"ltp": 1750.0, "change_pct": 1.92, "volume": 1000000},
            "ICICIBANK": {"ltp": 1100.0, "change_pct": -0.45, "volume": 800000},
            "RELIANCE": {"ltp": 2500.0, "change_pct": 0.75, "volume": 1200000},
        }
        rows = _build_rows(symbols, weights, quotes)
        assert len(rows) == 3
        # Should be sorted by change_pct descending
        assert rows[0]["symbol"] == "HDFCBANK"
        assert rows[1]["symbol"] == "RELIANCE"
        assert rows[2]["symbol"] == "ICICIBANK"
        # Contribution present
        assert "contribution_pct" in rows[0]
        assert abs(rows[0]["contribution_pct"] - 0.192) < 0.001

    def test_build_rows_missing_quote(self):
        symbols = ["HDFCBANK", "ICICIBANK"]
        weights = {"HDFCBANK": 10.0, "ICICIBANK": 8.0}
        quotes = {
            "HDFCBANK": {"ltp": 1750.0, "change_pct": 1.92, "volume": 1000000},
            # ICICIBANK missing
        }
        rows = _build_rows(symbols, weights, quotes)
        assert len(rows) == 1
        assert rows[0]["symbol"] == "HDFCBANK"

    def test_build_rows_no_weight(self):
        symbols = ["NEWSYM"]
        weights = {}
        quotes = {"NEWSYM": {"ltp": 100.0, "change_pct": 2.0, "volume": 50000}}
        rows = _build_rows(symbols, weights, quotes)
        assert len(rows) == 1
        assert "contribution_pct" not in rows[0]


class TestFetchQuotes:
    """Test the Upstox quotes fetch (mocked)."""

    @pytest.mark.asyncio
    async def test_fetch_quotes_success(self):
        with patch("api.reports_api.movers.token_with_source", return_value=("test-token", "test")):
            with patch("api.reports_api.movers.get") as mock_get:
                mock_get.return_value = {
                    "data": {
                        "NSE_EQ|HDFCBANK": {"last_price": 1750.0, "close_price": 1717.0, "volume": 1000000},
                        "NSE_EQ|ICICIBANK": {"last_price": 1100.0, "close_price": 1105.0, "volume": 800000},
                    }
                }
                quotes = await _fetch_quotes(["HDFCBANK", "ICICIBANK"])
                assert "HDFCBANK" in quotes
                assert "ICICIBANK" in quotes
                assert quotes["HDFCBANK"]["change_pct"] == round((1750 - 1717) / 1717 * 100, 2)
                assert quotes["ICICIBANK"]["change_pct"] == round((1100 - 1105) / 1105 * 100, 2)

    @pytest.mark.asyncio
    async def test_fetch_quotes_no_token(self):
        with patch("api.reports_api.movers.token_with_source", return_value=("", "")):
            quotes = await _fetch_quotes(["HDFCBANK"])
            assert quotes == {}

    @pytest.mark.asyncio
    async def test_fetch_quotes_http_error(self):
        with patch("api.reports_api.movers.token_with_source", return_value=("test-token", "test")):
            with patch("api.reports_api.movers.get", side_effect=Exception("HTTP 500")):
                quotes = await _fetch_quotes(["HDFCBANK"])
                assert quotes == {}


class TestEndpoint:
    """Test the /api/reports/movers endpoint."""

    @pytest.fixture
    def client(self):
        from api_server_fastapi import app
        return TestClient(app)

    def test_movers_invalid_index(self, client):
        resp = client.get("/api/reports/movers?index=INVALID")
        assert resp.status_code == 400
        assert "Invalid index" in resp.json()["detail"]

    def test_movers_valid_index_params(self, client):
        with patch("api.reports_api.movers._fetch_quotes", new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = {
                "HDFCBANK": {"ltp": 1750.0, "change_pct": 1.92, "volume": 1000000},
                "ICICIBANK": {"ltp": 1100.0, "change_pct": -0.45, "volume": 800000},
                "RELIANCE": {"ltp": 2500.0, "change_pct": 0.75, "volume": 1200000},
            }
            # Use the internal cache clearing to ensure fresh state
            from api.reports_api.movers import _clear_cache
            _clear_cache()
            resp = client.get("/api/reports/movers?index=NIFTY&limit=2")
            assert resp.status_code == 200
            data = resp.json()
            assert data["index"] == "NIFTY"
            assert "as_of" in data
            assert "gainers" in data
            assert "losers" in data
            assert len(data["gainers"]) <= 2
            assert len(data["losers"]) <= 2
            assert data["live_only"] is False

    def test_movers_limit_all(self, client):
        with patch("api.reports_api.movers._fetch_quotes", new_callable=AsyncMock) as mock_fetch:
            # Return quotes for all NIFTY50 symbols
            quotes = {sym: {"ltp": 100.0 + i, "change_pct": (i - 25) * 0.1, "volume": 100000}
                      for i, sym in enumerate(NIFTY50_SYMBOLS)}
            mock_fetch.return_value = quotes
            from api.reports_api.movers import _clear_cache
            _clear_cache()
            resp = client.get("/api/reports/movers?index=NIFTY&limit=all")
            assert resp.status_code == 200
            data = resp.json()
            assert data["index"] == "NIFTY"
            # All positive change_pct in gainers, negative in losers
            assert all(r["change_pct"] > 0 for r in data["gainers"])
            assert all(r["change_pct"] < 0 for r in data["losers"])

    def test_movers_sensex_no_weights(self, client):
        """SENSEX returns data but without contribution_pct (no verified weights)."""
        with patch("api.reports_api.movers._fetch_quotes", new_callable=AsyncMock) as mock_fetch:
            # Return quotes for all SENSEX symbols
            from api.reports_api.movers import _select_index_constituents
            symbols, _, _ = _select_index_constituents("SENSEX")
            quotes = {sym: {"ltp": 100.0 + i, "change_pct": (i - 15) * 0.1, "volume": 100000}
                      for i, sym in enumerate(symbols)}
            mock_fetch.return_value = quotes
            from api.reports_api.movers import _clear_cache
            _clear_cache()
            resp = client.get("/api/reports/movers?index=SENSEX&limit=3")
            assert resp.status_code == 200
            data = resp.json()
            assert data["index"] == "SENSEX"
            # No contribution_pct since no weights
            for row in data["gainers"] + data["losers"]:
                assert "contribution_pct" not in row

    def test_movers_503_on_no_quotes(self, client):
        with patch("api.reports_api.movers._fetch_quotes", new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = {}
            from api.reports_api.movers import _clear_cache
            _clear_cache()
            resp = client.get("/api/reports/movers?index=NIFTY")
            assert resp.status_code == 503
            assert resp.json()["detail"]["code"] == "movers_unavailable"

    def test_movers_cache_per_index_only(self, client):
        """Cache key should be per index only, not include limit."""
        with patch("api.reports_api.movers._fetch_quotes", new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = {
                "HDFCBANK": {"ltp": 1750.0, "change_pct": 1.92, "volume": 1000000},
                "ICICIBANK": {"ltp": 1100.0, "change_pct": -0.45, "volume": 800000},
                "RELIANCE": {"ltp": 2500.0, "change_pct": 0.75, "volume": 1200000},
            }
            from api.reports_api.movers import _clear_cache
            _clear_cache()
            # First call with limit=2
            resp1 = client.get("/api/reports/movers?index=NIFTY&limit=2")
            assert resp1.status_code == 200
            assert len(resp1.json()["gainers"]) <= 2
            # Second call with limit=3 should use cache (same index)
            resp2 = client.get("/api/reports/movers?index=NIFTY&limit=3")
            assert resp2.status_code == 200
            # Should have sliced from cached data
            assert len(resp2.json()["gainers"]) <= 3
            assert mock_fetch.call_count == 1  # Only one upstream call


    def test_movers_cache_grows_with_larger_limit(self, client):
        """limit=3 warms the cache with full lists; limit=5 must return 5."""
        with patch("api.reports_api.movers._fetch_quotes", new_callable=AsyncMock) as mock_fetch:
            quotes = {}
            for i, sym in enumerate(NIFTY50_SYMBOLS):
                if i < 6:
                    change_pct = 2.0 - i * 0.1  # 6 gainers
                elif i < 12:
                    change_pct = -2.0 + (i - 6) * 0.1  # 6 losers
                else:
                    change_pct = 0.0
                quotes[sym] = {"ltp": 100.0 + i, "change_pct": change_pct, "volume": 100_000}
            mock_fetch.return_value = quotes
            from api.reports_api.movers import _clear_cache
            _clear_cache()

            first = client.get("/api/reports/movers?index=NIFTY&limit=3")
            assert first.status_code == 200
            assert len(first.json()["gainers"]) == 3
            assert len(first.json()["losers"]) == 3

            second = client.get("/api/reports/movers?index=NIFTY&limit=5")
            assert second.status_code == 200
            assert len(second.json()["gainers"]) == 5
            assert len(second.json()["losers"]) == 5
            assert mock_fetch.call_count == 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
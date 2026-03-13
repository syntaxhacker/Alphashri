"""
Sector API Tests

Tests for /api/sector endpoints.

Test cases cover:
- Pydantic model validation (SectorItem, StockMover, SectorResponse)
- _to_float helper function
- API endpoint with mocked TradingView data
"""

import sys
from pathlib import Path

import pytest
import pandas as pd
from unittest.mock import patch, MagicMock
from datetime import datetime
from fastapi import FastAPI
from fastapi.testclient import TestClient

# Add project root to path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from api.sector import (
    router,
    _to_float,
    SectorItem,
    StockMover,
    SectorResponse,
    get_sector_performance,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

SAMPLE_SECTOR_DATA = pd.DataFrame({
    'name': ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'LT'],
    'close': [2500.0, 3800.0, 1600.0, 1500.0, 950.0, 3200.0],
    'change': [2.5, -1.2, 1.8, 0.5, -0.7, 3.1],
    'sector': ['Energy', 'Technology', 'Finance', 'Technology', 'Finance', 'Industrials'],
    'market_cap_basic': [16_000_000_000_000, 14_000_000_000_000, 9_000_000_000_000,
                         6_000_000_000_000, 7_000_000_000_000, 5_000_000_000_000],
    'RSI': [65.0, 45.0, 70.0, 55.0, 48.0, 72.0],
    'ADX': [35.0, 25.0, 40.0, 20.0, 30.0, 38.0],
})


@pytest.fixture
def sector_client():
    """Create a FastAPI TestClient with only the sector router."""
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as c:
        yield c


# ===========================================================================
# TestSectorModels
# ===========================================================================

class TestSectorModels:
    """Test Pydantic model validation for SectorItem, StockMover, SectorResponse."""

    def test_sector_item_valid(self):
        item = SectorItem(
            sector="Technology",
            avg_change=1.5,
            stock_count=10,
            advances=7,
            declines=3,
            avg_rsi=60.0,
            avg_adx=30.0,
            top_movers="TCS(+2.0%) INFY(+1.5%)",
        )
        assert item.sector == "Technology"
        assert item.avg_change == 1.5
        assert item.stock_count == 10

    def test_sector_item_missing_field_raises(self):
        with pytest.raises(Exception):
            SectorItem(sector="Tech", avg_change=1.0)  # missing required fields

    def test_sector_item_type_coercion(self):
        """Pydantic coerces compatible types."""
        item = SectorItem(
            sector="Finance",
            avg_change="2.5",
            stock_count="8",
            advances="5",
            declines="3",
            avg_rsi="55.0",
            avg_adx="28.0",
            top_movers="HDFC(+3%)",
        )
        assert item.avg_change == 2.5
        assert item.stock_count == 8

    def test_stock_mover_valid(self):
        mover = StockMover(symbol="RELIANCE", change=2.5)
        assert mover.symbol == "RELIANCE"
        assert mover.change == 2.5

    def test_stock_mover_missing_field_raises(self):
        with pytest.raises(Exception):
            StockMover(symbol="TCS")  # missing 'change'

    def test_sector_response_valid(self):
        resp = SectorResponse(
            sectors=[
                SectorItem(
                    sector="Tech", avg_change=1.0, stock_count=5,
                    advances=3, declines=2, avg_rsi=60.0, avg_adx=25.0,
                    top_movers="TCS(+2%)",
                )
            ],
            top_stock_movers=[StockMover(symbol="TCS", change=2.0)],
            last_updated=datetime(2026, 1, 1, 12, 0, 0),
            market="india",
        )
        assert len(resp.sectors) == 1
        assert resp.market == "india"

    def test_sector_response_empty_lists(self):
        resp = SectorResponse(
            sectors=[],
            top_stock_movers=[],
            last_updated=datetime.now(),
            market="america",
        )
        assert resp.sectors == []
        assert resp.top_stock_movers == []


# ===========================================================================
# TestSectorHelperLogic
# ===========================================================================

class TestSectorHelperLogic:
    """Test _to_float helper function."""

    def test_to_float_valid_int(self):
        assert _to_float(10) == 10.0

    def test_to_float_valid_float(self):
        assert _to_float(3.14) == 3.14

    def test_to_float_valid_string(self):
        assert _to_float("2.71") == 2.71

    def test_to_float_none_returns_default(self):
        assert _to_float(None) == 0.0

    def test_to_float_none_custom_default(self):
        assert _to_float(None, default=5.0) == 5.0

    def test_to_float_inf_returns_default(self):
        assert _to_float(float('inf')) == 0.0

    def test_to_float_neg_inf_returns_default(self):
        assert _to_float(float('-inf')) == 0.0

    def test_to_float_nan_returns_default(self):
        assert _to_float(float('nan')) == 0.0

    def test_to_float_invalid_string_returns_default(self):
        assert _to_float("not_a_number") == 0.0

    def test_to_float_empty_string_returns_default(self):
        assert _to_float("") == 0.0

    def test_to_float_zero(self):
        assert _to_float(0) == 0.0

    def test_to_float_negative(self):
        assert _to_float(-5.5) == -5.5


# ===========================================================================
# TestSectorEndpoints
# ===========================================================================

class TestSectorEndpoints:
    """Test /api/sector endpoints with mocked TradingView data."""

    @patch('api.sector.TVQuery')
    def test_get_sector_performance_success(self, mock_tvquery_cls, sector_client):
        """Test successful sector performance response."""
        mock_query = MagicMock()
        mock_query.select.return_value = mock_query
        mock_query.set_markets.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.get_scanner_data.return_value = (None, SAMPLE_SECTOR_DATA.copy())
        mock_tvquery_cls.return_value = mock_query

        response = sector_client.get("/api/sector", params={"market": "india", "limit": 500})

        assert response.status_code == 200
        data = response.json()
        assert "sectors" in data
        assert "top_stock_movers" in data
        assert "last_updated" in data
        assert "market" in data
        assert data["market"] == "india"
        assert len(data["sectors"]) > 0

    @patch('api.sector.TVQuery')
    def test_get_sector_performance_empty_dataframe(self, mock_tvquery_cls, sector_client):
        """Test response when TradingView returns empty data."""
        mock_query = MagicMock()
        mock_query.select.return_value = mock_query
        mock_query.set_markets.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.get_scanner_data.return_value = (None, pd.DataFrame())
        mock_tvquery_cls.return_value = mock_query

        response = sector_client.get("/api/sector", params={"market": "america"})

        assert response.status_code == 200
        data = response.json()
        assert data["sectors"] == []
        assert data["top_stock_movers"] == []
        assert data["market"] == "america"

    @patch('api.sector.TVQuery')
    def test_get_sector_performance_sectors_sorted_by_performance(self, mock_tvquery_cls, sector_client):
        """Test that sectors are sorted by avg_change descending."""
        mock_query = MagicMock()
        mock_query.select.return_value = mock_query
        mock_query.set_markets.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.get_scanner_data.return_value = (None, SAMPLE_SECTOR_DATA.copy())
        mock_tvquery_cls.return_value = mock_query

        response = sector_client.get("/api/sector", params={"market": "india"})

        assert response.status_code == 200
        sectors = response.json()["sectors"]
        changes = [s["avg_change"] for s in sectors]
        assert changes == sorted(changes, reverse=True)

    @patch('api.sector.TVQuery')
    def test_get_sector_performance_top_movers_populated(self, mock_tvquery_cls, sector_client):
        """Test that top_stock_movers are returned and sorted by change."""
        mock_query = MagicMock()
        mock_query.select.return_value = mock_query
        mock_query.set_markets.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.get_scanner_data.return_value = (None, SAMPLE_SECTOR_DATA.copy())
        mock_tvquery_cls.return_value = mock_query

        response = sector_client.get("/api/sector", params={"market": "india"})

        assert response.status_code == 200
        movers = response.json()["top_stock_movers"]
        assert len(movers) > 0
        # Verify sorted descending by change
        changes = [m["change"] for m in movers]
        assert changes == sorted(changes, reverse=True)

    @patch('api.sector.TVQuery')
    def test_get_sector_performance_default_params(self, mock_tvquery_cls, sector_client):
        """Test endpoint with default query parameters."""
        mock_query = MagicMock()
        mock_query.select.return_value = mock_query
        mock_query.set_markets.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.get_scanner_data.return_value = (None, SAMPLE_SECTOR_DATA.copy())
        mock_tvquery_cls.return_value = mock_query

        response = sector_client.get("/api/sector")

        assert response.status_code == 200
        data = response.json()
        assert data["market"] == "india"  # default market

    @patch('api.sector.TVQuery')
    def test_get_sector_performance_api_error(self, mock_tvquery_cls, sector_client):
        """Test that TradingView API errors are handled as 500."""
        mock_query = MagicMock()
        mock_query.select.return_value = mock_query
        mock_query.set_markets.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.get_scanner_data.side_effect = Exception("Connection timeout")
        mock_tvquery_cls.return_value = mock_query

        response = sector_client.get("/api/sector", params={"market": "india"})

        assert response.status_code == 500
        assert "Connection timeout" in response.json()["detail"]

    @patch('api.sector.TVQuery')
    def test_get_sector_performance_america_market(self, mock_tvquery_cls, sector_client):
        """Test america market path (no market cap filter)."""
        mock_query = MagicMock()
        mock_query.select.return_value = mock_query
        mock_query.set_markets.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.get_scanner_data.return_value = (None, SAMPLE_SECTOR_DATA.copy())
        mock_tvquery_cls.return_value = mock_query

        response = sector_client.get("/api/sector", params={"market": "america"})

        assert response.status_code == 200
        assert response.json()["market"] == "america"

    @patch('api.sector.TVQuery')
    def test_get_sector_performance_deduplicates_stocks(self, mock_tvquery_cls, sector_client):
        """Test that duplicate stock names are deduplicated."""
        df_with_dupes = pd.DataFrame({
            'name': ['RELIANCE', 'RELIANCE', 'TCS'],
            'close': [2500.0, 2505.0, 3800.0],
            'change': [2.5, 2.5, -1.2],
            'sector': ['Energy', 'Energy', 'Technology'],
            'market_cap_basic': [16e12, 16e12, 14e12],
            'RSI': [65.0, 65.0, 45.0],
            'ADX': [35.0, 35.0, 25.0],
        })

        mock_query = MagicMock()
        mock_query.select.return_value = mock_query
        mock_query.set_markets.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.get_scanner_data.return_value = (None, df_with_dupes)
        mock_tvquery_cls.return_value = mock_query

        response = sector_client.get("/api/sector", params={"market": "india"})

        assert response.status_code == 200
        # Total top movers should reflect deduplicated stocks (2 unique)
        movers = response.json()["top_stock_movers"]
        mover_symbols = [m["symbol"] for m in movers]
        assert mover_symbols.count("RELIANCE") == 1

    @patch('api.sector.TVQuery')
    def test_get_sector_performance_sector_item_fields(self, mock_tvquery_cls, sector_client):
        """Test that SectorItem contains all expected fields."""
        mock_query = MagicMock()
        mock_query.select.return_value = mock_query
        mock_query.set_markets.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.get_scanner_data.return_value = (None, SAMPLE_SECTOR_DATA.copy())
        mock_tvquery_cls.return_value = mock_query

        response = sector_client.get("/api/sector", params={"market": "india"})

        sector = response.json()["sectors"][0]
        assert "sector" in sector
        assert "avg_change" in sector
        assert "stock_count" in sector
        assert "advances" in sector
        assert "declines" in sector
        assert "avg_rsi" in sector
        assert "avg_adx" in sector
        assert "top_movers" in sector

    @patch('api.sector.TVQuery')
    def test_get_sector_performance_last_updated_is_iso(self, mock_tvquery_cls, sector_client):
        """Test that last_updated is a valid ISO datetime string."""
        mock_query = MagicMock()
        mock_query.select.return_value = mock_query
        mock_query.set_markets.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.get_scanner_data.return_value = (None, SAMPLE_SECTOR_DATA.copy())
        mock_tvquery_cls.return_value = mock_query

        response = sector_client.get("/api/sector", params={"market": "india"})

        last_updated = response.json()["last_updated"]
        # Should be parseable as ISO datetime
        parsed = datetime.fromisoformat(last_updated)
        assert isinstance(parsed, datetime)

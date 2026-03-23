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
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as c:
        yield c


def _setup_mock_tvquery(mock_tvquery_cls, data=None):
    if data is None:
        data = SAMPLE_SECTOR_DATA
    mock_query = MagicMock()
    mock_query.select.return_value = mock_query
    mock_query.set_markets.return_value = mock_query
    mock_query.where.return_value = mock_query
    mock_query.order_by.return_value = mock_query
    mock_query.limit.return_value = mock_query
    mock_query.get_scanner_data.return_value = (None, data.copy())
    mock_tvquery_cls.return_value = mock_query
    return mock_query


class TestSectorModels:

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
            SectorItem(sector="Tech", avg_change=1.0)

    def test_sector_item_type_coercion(self):
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
            StockMover(symbol="TCS")

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


class TestSectorHelperLogic:

    @pytest.mark.parametrize("input_val,expected", [
        (10, 10.0),
        (3.14, 3.14),
        ("2.71", 2.71),
        (None, 0.0),
        (float('inf'), 0.0),
        (float('-inf'), 0.0),
        (float('nan'), 0.0),
        ("not_a_number", 0.0),
        ("", 0.0),
        (0, 0.0),
        (-5.5, -5.5),
    ])
    def test_to_float(self, input_val, expected):
        assert _to_float(input_val) == expected

    def test_to_float_none_custom_default(self):
        assert _to_float(None, default=5.0) == 5.0


def _fetch_sector_data(mock_tvquery_cls, sector_client, data=None, params=None):
    _setup_mock_tvquery(mock_tvquery_cls, data)
    response = sector_client.get("/api/sector", params=params or {})
    assert response.status_code == 200
    return response.json()


class TestSectorEndpoints:

    @patch('api.sector.TVQuery')
    def test_get_sector_performance_success(self, mock_tvquery_cls, sector_client):
        data = _fetch_sector_data(mock_tvquery_cls, sector_client, params={"market": "india", "limit": 500})

        assert "sectors" in data
        assert "top_stock_movers" in data
        assert "last_updated" in data
        assert "market" in data
        assert data["market"] == "india"
        assert len(data["sectors"]) > 0

    @patch('api.sector.TVQuery')
    def test_get_sector_performance_empty_dataframe(self, mock_tvquery_cls, sector_client):
        data = _fetch_sector_data(mock_tvquery_cls, sector_client, data=pd.DataFrame(), params={"market": "america"})

        assert data["sectors"] == []
        assert data["top_stock_movers"] == []
        assert data["market"] == "america"

    @patch('api.sector.TVQuery')
    def test_get_sector_performance_sectors_sorted_by_performance(self, mock_tvquery_cls, sector_client):
        data = _fetch_sector_data(mock_tvquery_cls, sector_client, params={"market": "india"})
        changes = [s["avg_change"] for s in data["sectors"]]
        assert changes == sorted(changes, reverse=True)

    @patch('api.sector.TVQuery')
    def test_get_sector_performance_top_movers_populated(self, mock_tvquery_cls, sector_client):
        data = _fetch_sector_data(mock_tvquery_cls, sector_client, params={"market": "india"})
        movers = data["top_stock_movers"]
        assert len(movers) > 0
        changes = [m["change"] for m in movers]
        assert changes == sorted(changes, reverse=True)

    @pytest.mark.parametrize("params,expected_market", [
        ({}, "india"),
        ({"market": "america"}, "america"),
    ])
    @patch('api.sector.TVQuery')
    def test_get_sector_performance_market_param(self, mock_tvquery_cls, sector_client, params, expected_market):
        data = _fetch_sector_data(mock_tvquery_cls, sector_client, params=params)
        assert data["market"] == expected_market

    @patch('api.sector.TVQuery')
    def test_get_sector_performance_api_error(self, mock_tvquery_cls, sector_client):
        mock_query = _setup_mock_tvquery(mock_tvquery_cls)
        mock_query.get_scanner_data.side_effect = Exception("Connection timeout")

        response = sector_client.get("/api/sector", params={"market": "india"})

        assert response.status_code == 500
        assert "Connection timeout" in response.json()["detail"]

    @patch('api.sector.TVQuery')
    def test_get_sector_performance_deduplicates_stocks(self, mock_tvquery_cls, sector_client):
        df_with_dupes = pd.DataFrame({
            'name': ['RELIANCE', 'RELIANCE', 'TCS'],
            'close': [2500.0, 2505.0, 3800.0],
            'change': [2.5, 2.5, -1.2],
            'sector': ['Energy', 'Energy', 'Technology'],
            'market_cap_basic': [16e12, 16e12, 14e12],
            'RSI': [65.0, 65.0, 45.0],
            'ADX': [35.0, 35.0, 25.0],
        })
        data = _fetch_sector_data(mock_tvquery_cls, sector_client, data=df_with_dupes, params={"market": "india"})

        mover_symbols = [m["symbol"] for m in data["top_stock_movers"]]
        assert mover_symbols.count("RELIANCE") == 1

    @patch('api.sector.TVQuery')
    def test_get_sector_performance_sector_item_fields(self, mock_tvquery_cls, sector_client):
        data = _fetch_sector_data(mock_tvquery_cls, sector_client, params={"market": "india"})
        sector = data["sectors"][0]
        for field in ("sector", "avg_change", "stock_count", "advances", "declines", "avg_rsi", "avg_adx", "top_movers"):
            assert field in sector

    @patch('api.sector.TVQuery')
    def test_get_sector_performance_last_updated_is_iso(self, mock_tvquery_cls, sector_client):
        data = _fetch_sector_data(mock_tvquery_cls, sector_client, params={"market": "india"})
        parsed = datetime.fromisoformat(data["last_updated"])
        assert isinstance(parsed, datetime)

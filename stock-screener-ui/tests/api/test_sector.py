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
from unittest.mock import patch
from datetime import datetime, timedelta
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import config

import api.sector as sector_module
from api.sector import (
    router,
    _to_float,
    SectorItem,
    StockMover,
    SectorResponse,
    get_sector_performance,
    clear_sector_cache,
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


@pytest.fixture(autouse=True)
def _clear_response_cache():
    """The endpoint caches per (market, limit); keep tests isolated."""
    clear_sector_cache()
    yield
    clear_sector_cache()


@pytest.fixture
def sector_client():
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as c:
        yield c


def _setup_scan(mock_scan, data=None):
    """Feed a frame to the shared gateway scanner stand-in."""
    if data is None:
        data = SAMPLE_SECTOR_DATA
    mock_scan.side_effect = None
    mock_scan.return_value = data.copy() if hasattr(data, "copy") else data
    return mock_scan


def _assert_ist_last_updated(raw):
    # The dashboard renders this as a clock time, so a naive host-clock value
    # silently shows the wrong time; the offset is part of the contract.
    parsed = datetime.fromisoformat(raw)
    assert isinstance(parsed, datetime)
    assert parsed.tzinfo is not None
    assert parsed.utcoffset() == timedelta(hours=5, minutes=30)
    assert parsed.tzinfo == config.IST


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


def _fetch_sector_data(mock_scan, sector_client, data=None, params=None):
    _setup_scan(mock_scan, data)
    response = sector_client.get("/api/sector", params=params or {})
    assert response.status_code == 200
    return response.json()


class TestSectorEndpoints:

    @patch('api.tv.cache.scan_frame')
    def test_get_sector_performance_success(self, mock_scan, sector_client):
        data = _fetch_sector_data(mock_scan, sector_client, params={"market": "india", "limit": 500})

        assert "sectors" in data
        assert "top_stock_movers" in data
        assert "last_updated" in data
        assert "market" in data
        assert data["market"] == "india"
        assert len(data["sectors"]) > 0

    @patch('api.tv.cache.scan_frame')
    def test_get_sector_performance_empty_dataframe(self, mock_scan, sector_client):
        data = _fetch_sector_data(mock_scan, sector_client, data=pd.DataFrame(), params={"market": "america"})

        assert data["sectors"] == []
        assert data["top_stock_movers"] == []
        assert data["market"] == "america"
        _assert_ist_last_updated(data["last_updated"])

    @patch('api.tv.cache.scan_frame')
    def test_get_sector_performance_sectors_sorted_by_performance(self, mock_scan, sector_client):
        data = _fetch_sector_data(mock_scan, sector_client, params={"market": "india"})
        changes = [s["avg_change"] for s in data["sectors"]]
        assert changes == sorted(changes, reverse=True)

    @patch('api.tv.cache.scan_frame')
    def test_get_sector_performance_top_movers_populated(self, mock_scan, sector_client):
        data = _fetch_sector_data(mock_scan, sector_client, params={"market": "india"})
        movers = data["top_stock_movers"]
        assert len(movers) > 0
        changes = [m["change"] for m in movers]
        assert changes == sorted(changes, reverse=True)

    @pytest.mark.parametrize("params,expected_market", [
        ({}, "india"),
        ({"market": "america"}, "america"),
    ])
    @patch('api.tv.cache.scan_frame')
    def test_get_sector_performance_market_param(self, mock_scan, sector_client, params, expected_market):
        data = _fetch_sector_data(mock_scan, sector_client, params=params)
        assert data["market"] == expected_market

    @patch('api.tv.cache.scan_frame')
    def test_get_sector_performance_api_error(self, mock_scan, sector_client):
        _setup_scan(mock_scan)
        mock_scan.side_effect = Exception("Connection timeout")

        response = sector_client.get("/api/sector", params={"market": "india"})

        assert response.status_code == 500
        assert "Connection timeout" in response.json()["detail"]

    @patch('api.tv.cache.scan_frame')
    def test_get_sector_performance_deduplicates_stocks(self, mock_scan, sector_client):
        df_with_dupes = pd.DataFrame({
            'name': ['RELIANCE', 'RELIANCE', 'TCS'],
            'close': [2500.0, 2505.0, 3800.0],
            'change': [2.5, 2.5, -1.2],
            'sector': ['Energy', 'Energy', 'Technology'],
            'market_cap_basic': [16e12, 16e12, 14e12],
            'RSI': [65.0, 65.0, 45.0],
            'ADX': [35.0, 35.0, 25.0],
        })
        data = _fetch_sector_data(mock_scan, sector_client, data=df_with_dupes, params={"market": "india"})

        mover_symbols = [m["symbol"] for m in data["top_stock_movers"]]
        assert mover_symbols.count("RELIANCE") == 1

    @patch('api.tv.cache.scan_frame')
    def test_get_sector_performance_sector_item_fields(self, mock_scan, sector_client):
        data = _fetch_sector_data(mock_scan, sector_client, params={"market": "india"})
        sector = data["sectors"][0]
        for field in ("sector", "avg_change", "stock_count", "advances", "declines", "avg_rsi", "avg_adx", "top_movers"):
            assert field in sector

    @patch('api.tv.cache.scan_frame')
    def test_get_sector_performance_last_updated_is_iso(self, mock_scan, sector_client):
        data = _fetch_sector_data(mock_scan, sector_client, params={"market": "india"})
        _assert_ist_last_updated(data["last_updated"])

    @pytest.mark.parametrize("frame,side_effect", [
        (SAMPLE_SECTOR_DATA, None),
        (pd.DataFrame(), None),
        (None, RuntimeError("tv down")),
    ])
    def test_group_performance_last_updated_has_ist_offset(self, frame, side_effect, sector_client):
        sector_module._group_cache.clear()
        try:
            with patch.object(sector_module, "_fetch_group_data",
                              return_value=frame, side_effect=side_effect):
                response = sector_client.get(
                    "/api/sector/groups", params={"classify": "sector", "period": "1D"}
                )
            assert response.status_code == 200
            _assert_ist_last_updated(response.json()["last_updated"])
        finally:
            sector_module._group_cache.clear()


class TestSectorResponseCache:
    """The dashboard polls this endpoint; one upstream scan is shared briefly."""

    @patch('api.tv.cache.scan_frame')
    def test_repeat_request_within_ttl_uses_cache(self, mock_scan, sector_client):
        _setup_scan(mock_scan)

        first = sector_client.get("/api/sector", params={"market": "india"})
        second = sector_client.get("/api/sector", params={"market": "india"})

        assert first.status_code == 200
        assert second.status_code == 200
        assert mock_scan.call_count == 1
        assert first.json()["last_updated"] == second.json()["last_updated"]

    @patch('api.tv.cache.scan_frame')
    def test_cache_is_per_market(self, mock_scan, sector_client):
        _setup_scan(mock_scan)

        sector_client.get("/api/sector", params={"market": "india"})
        sector_client.get("/api/sector", params={"market": "america"})

        assert mock_scan.call_count == 2

    @patch('api.tv.cache.scan_frame')
    def test_force_bypasses_cache(self, mock_scan, sector_client):
        _setup_scan(mock_scan)

        sector_client.get("/api/sector", params={"market": "india"})
        sector_client.get("/api/sector", params={"market": "india", "force": "true"})

        assert mock_scan.call_count == 2

    @patch('api.tv.cache.scan_frame')
    def test_expired_entry_refetches(self, mock_scan, sector_client):
        mock_query = _setup_scan(mock_scan)

        with patch('api.sector.SECTOR_CACHE_TTL_SECONDS', 0.0):
            sector_client.get("/api/sector", params={"market": "india"})
            sector_client.get("/api/sector", params={"market": "india"})

        assert mock_scan.call_count == 2

    @patch('api.tv.cache.scan_frame')
    def test_failed_refresh_serves_recent_stale_snapshot(self, mock_scan, sector_client):
        mock_query = _setup_scan(mock_scan)
        first = sector_client.get("/api/sector", params={"market": "india"})
        assert first.status_code == 200

        mock_scan.side_effect = Exception("TradingView timeout")
        with patch('api.sector.SECTOR_CACHE_TTL_SECONDS', 0.0):
            second = sector_client.get("/api/sector", params={"market": "india"})

        assert second.status_code == 200
        assert second.json()["last_updated"] == first.json()["last_updated"]

    @patch('api.tv.cache.scan_frame')
    def test_error_without_snapshot_still_500s(self, mock_scan, sector_client):
        mock_query = _setup_scan(mock_scan)
        mock_scan.side_effect = Exception("TradingView timeout")

        response = sector_client.get("/api/sector", params={"market": "india"})

        assert response.status_code == 500
        assert "TradingView timeout" in response.json()["detail"]

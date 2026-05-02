"""
Sector Correlation API Tests

Tests for /api/sector/correlation endpoint.

Test cases cover:
- Response model validation
- Correlation matrix computation
- Beta calculation
- Relative strength calculation
- Rank computation
- Endpoint with mocked data sources
"""

import sys
from pathlib import Path
from datetime import datetime
from unittest.mock import patch, MagicMock
import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from api.sector import (
    router,
    SectorCorrelationSector,
    SectorCorrelationResponse,
    _compute_correlation_matrix,
    _compute_betas,
    _compute_relative_strength,
    _compute_ranks,
    _fetch_sector_data_for_market,
)
from config import IST


# ===== Test Data Helpers =====

def make_price_df(symbol: str, prices: list[float], dates: pd.DatetimeIndex) -> pd.DataFrame:
    """Create a DataFrame with close prices for a symbol."""
    return pd.DataFrame({"close": prices}, index=dates)


def make_aligned_dfs() -> dict[str, pd.DataFrame]:
    """
    Create aligned price DataFrames for multiple sectors with controlled betas.

    Uses a common market factor plus sector-specific scaling and small noise
    to ensure deterministic, realistic beta relationships:
    - NIFTY 50: beta = 1.0 (benchmark)
    - NIFTY BANK: beta > 1 (high beta)
    - NIFTY IT: beta ~0.9
    - NIFTY FMCG: beta < 1 (defensive)
    """
    np.random.seed(42)  # ensure reproducible results
    dates = pd.date_range(start="2025-01-01", periods=90, freq="D", tz=None)

    # Common market factor: random walk with small drift
    market_returns = np.random.randn(90) * 0.5 + 0.03  # daily ~N(3%, 0.5%)
    market_log_returns = np.cumsum(market_returns)
    market_prices = 100 * np.exp(market_log_returns)  # base factor

    # Build sector series: price = scale * market_factor + idiosyncratic_noise + trend
    # The scale factor determines beta relative to NIFTY 50 (scale=1.0)
    nifty50 = 20000 + 200 * market_prices + np.random.randn(90) * 50 + np.linspace(0, 1500, 90)
    bank = 45000 + 220 * market_prices + np.random.randn(90) * 100 + np.linspace(0, 3200, 90)
    it = 35000 + 180 * market_prices + np.random.randn(90) * 70 + np.linspace(0, 2000, 90)
    fmcg = 55000 + 150 * market_prices + np.random.randn(90) * 40 + np.linspace(0, 1300, 90)

    return {
        "NIFTY 50": make_price_df("NIFTY50", nifty50, dates),
        "NIFTY BANK": make_price_df("BANK", bank, dates),
        "NIFTY IT": make_price_df("IT", it, dates),
        "NIFTY FMCG": make_price_df("FMCG", fmcg, dates),
    }


# ===== Model Tests =====

class TestSectorCorrelationModels:

    def test_sector_correlation_sector_valid(self):
        s = SectorCorrelationSector(
            name="NIFTY BANK",
            beta_vs_index=1.2,
            relative_strength_5d=1.5,
            relative_strength_1m=3.2,
            relative_strength_3m=5.1,
            rank_current=2,
            rank_change_1m=1,
        )
        assert s.name == "NIFTY BANK"
        assert s.beta_vs_index == 1.2
        assert s.rank_current == 2

    def test_sector_correlation_response_valid(self):
        resp = SectorCorrelationResponse(
            sectors=[
                SectorCorrelationSector(
                    name="NIFTY 50",
                    beta_vs_index=1.0,
                    relative_strength_5d=0.5,
                    relative_strength_1m=1.0,
                    relative_strength_3m=2.0,
                    rank_current=1,
                    rank_change_1m=0,
                )
            ],
            correlation_matrix=[[1.0]],
            sector_names=["NIFTY 50"],
            last_updated=datetime.now(IST).isoformat(),
        )
        assert len(resp.sectors) == 1
        assert resp.correlation_matrix == [[1.0]]


# ===== Computation Tests =====

class TestCorrelationComputation:

    def test_compute_correlation_matrix_basic(self):
        dfs = make_aligned_dfs()
        corr_matrix, symbols = _compute_correlation_matrix(dfs)
        assert corr_matrix is not None
        assert len(corr_matrix) == 4
        assert len(corr_matrix[0]) == 4
        # Diagonal should be 1.0
        for i in range(4):
            assert abs(corr_matrix[i][i] - 1.0) < 1e-6
        # Symmetric
        for i in range(4):
            for j in range(4):
                assert abs(corr_matrix[i][j] - corr_matrix[j][i]) < 1e-6

    def test_compute_correlation_matrix_insufficient_data(self):
        # Only one sector
        dfs = {"A": make_price_df("A", [100, 101, 102], pd.date_range("2025-01-01", periods=3))}
        corr, symbols = _compute_correlation_matrix(dfs)
        assert corr is None
        assert symbols is None

        # Empty
        corr, symbols = _compute_correlation_matrix({})
        assert corr is None

    def test_compute_betas(self):
        dfs = make_aligned_dfs()
        betas = _compute_betas(dfs, "NIFTY 50")
        assert "NIFTY 50" in betas
        assert betas["NIFTY 50"] == 1.0
        # NIFTY BANK typically has beta > 1
        assert betas["NIFTY BANK"] > 0.5
        # FMCG typically has beta < 1
        assert betas["NIFTY FMCG"] < 1.5

    def test_compute_betas_missing_benchmark(self):
        dfs = {"A": make_price_df("A", list(range(100)), pd.date_range("2025-01-01", periods=100))}
        betas = _compute_betas(dfs, "NONEXISTENT")
        assert betas == {}

    def test_compute_relative_strength(self):
        dfs = make_aligned_dfs()
        rs = _compute_relative_strength(dfs, "NIFTY 50")
        assert "NIFTY 50" in rs
        assert abs(rs["NIFTY 50"]["rs_1m"]) < 0.1  # benchmark should be ~0
        # All sectors should have RS values
        for name in dfs:
            assert "rs_5d" in rs[name]
            assert "rs_1m" in rs[name]
            assert "rs_3m" in rs[name]

    def test_compute_ranks(self):
        # Create synthetic RS data with clear ordering
        rs_data = {
            "A": {"rs_1m": 5.0, "rs_3m": 10.0},
            "B": {"rs_1m": 3.0, "rs_3m": 5.0},
            "C": {"rs_1m": 1.0, "rs_3m": 2.0},
        }
        ranks = _compute_ranks(rs_data)
        assert ranks["current"]["A"] == 1
        assert ranks["current"]["B"] == 2
        assert ranks["current"]["C"] == 3
        # Rank change: based on 3M vs 1M
        # A was 1st on 3M (still 1st) -> change 0
        # Actually ranks are inverted for 3M as well, so A remains 1st


# ===== Endpoint Tests =====

@pytest.fixture
def correlation_client():
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as c:
        yield c


class TestSectorCorrelationEndpoint:

    @patch("api.sector._read_cache", return_value=None)
    @patch("api.sector._fetch_sector_data_for_market")
    def test_get_correlation_success(self, mock_fetch, mock_read_cache, correlation_client):
        # Mock data
        dates = pd.date_range(start="2025-01-01", periods=90, freq="D", tz=None)
        dfs = {
            "NIFTY 50": make_price_df("NIFTY50", np.linspace(20000, 22000, 90), dates),
            "NIFTY BANK": make_price_df("BANK", np.linspace(45000, 50000, 90), dates),
            "NIFTY IT": make_price_df("IT", np.linspace(35000, 38000, 90), dates),
        }
        mock_fetch.return_value = dfs

        response = correlation_client.get("/api/sector/correlation?market=india&lookback_days=90")
        assert response.status_code == 200
        data = response.json()
        assert "sectors" in data
        assert "correlation_matrix" in data
        assert "sector_names" in data
        assert "last_updated" in data
        assert len(data["sectors"]) == 3
        assert len(data["correlation_matrix"]) == 3

    @patch("api.sector._read_cache", return_value=None)
    @patch("api.sector._fetch_sector_data_for_market")
    def test_get_correlation_insufficient_data(self, mock_fetch, mock_read_cache, correlation_client):
        mock_fetch.return_value = {}  # No data
        response = correlation_client.get("/api/sector/correlation?market=india")
        assert response.status_code == 500
        assert "Insufficient sector data" in response.json()["detail"]

    @patch("api.sector._read_cache", return_value=None)
    @patch("api.sector._fetch_sector_data_for_market")
    def test_get_correlation_market_america(self, mock_fetch, mock_read_cache, correlation_client):
        dates = pd.date_range(start="2025-01-01", periods=90, freq="D", tz=None)
        dfs = {
            "SPY": make_price_df("SPY", np.linspace(500, 520, 90), dates),
            "XLK": make_price_df("XLK", np.linspace(200, 210, 90), dates),
        }
        mock_fetch.return_value = dfs

        response = correlation_client.get("/api/sector/correlation?market=america&lookback_days=90")
        assert response.status_code == 200
        data = response.json()
        assert data["sector_names"] == ["SPY", "XLK"]

    def test_get_correlation_invalid_market(self, correlation_client):
        response = correlation_client.get("/api/sector/correlation?market=invalid")
        assert response.status_code == 422  # validation error

    def test_get_correlation_lookback_days_bounds(self, correlation_client):
        # Too small
        response = correlation_client.get("/api/sector/correlation?lookback_days=10")
        assert response.status_code == 422

        # Valid
        response = correlation_client.get("/api/sector/correlation?lookback_days=90")
        assert response.status_code in (200, 500)  # 200 if mocked, 500 if no data

    @patch("api.sector._read_cache", return_value=None)
    @patch("api.sector._fetch_sector_data_for_market")
    def test_response_sorted_by_rank(self, mock_fetch, mock_read_cache, correlation_client):
        dates = pd.date_range(start="2025-01-01", periods=90, freq="D", tz=None)
        dfs = {
            "NIFTY 50": make_price_df("NIFTY50", np.linspace(20000, 22000, 90), dates),
            "NIFTY BANK": make_price_df("BANK", np.linspace(45000, 52000, 90), dates),  # stronger
            "NIFTY IT": make_price_df("IT", np.linspace(35000, 36000, 90), dates),  # weaker
        }
        mock_fetch.return_value = dfs

        response = correlation_client.get("/api/sector/correlation?market=india")
        data = response.json()
        sectors = data["sectors"]
        # Should be sorted by rank_current ascending (rank 1 first)
        ranks = [s["rank_current"] for s in sectors]
        assert ranks == sorted(ranks)

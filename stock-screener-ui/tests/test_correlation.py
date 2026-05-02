"""
Correlation API Tests.

Tests for api.correlation — _compute_correlation, cache helpers, and endpoint validation.
"""

import json
import sys
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from api.correlation import (
    _compute_correlation,
    _get_cache_meta_path,
    _get_cache_path,
    _make_cache_key,
    _read_cache,
    _write_cache,
)


# ---------------------------------------------------------------------------
# _compute_correlation
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestComputeCorrelation:

    def test_perfectly_correlated_series(self):
        idx = pd.date_range("2026-04-01", periods=20, freq="1D")
        base = np.array([100.0] * 20) * np.cumprod(1 + np.array([0.01, -0.005, 0.02, -0.01, 0.015, -0.008, 0.012, -0.003, 0.018, -0.007, 0.009, -0.011, 0.014, -0.006, 0.01, -0.004, 0.016, -0.009, 0.011, -0.002]))
        df1 = pd.DataFrame({"close": base}, index=idx)
        df2 = pd.DataFrame({"close": base * 3.5}, index=idx)

        matrix, symbols, normalized, meta = _compute_correlation({"A": df1, "B": df2})

        assert matrix is not None
        assert symbols == ["A", "B"]
        assert len(matrix) == 2
        assert len(matrix[0]) == 2
        assert abs(matrix[0][1] - 1.0) < 1e-6
        assert abs(matrix[1][0] - 1.0) < 1e-6
        assert matrix[0][0] == 1.0
        assert matrix[1][1] == 1.0

    def test_perfectly_anti_correlated_series(self):
        idx = pd.date_range("2026-04-01", periods=20, freq="1D")
        np.random.seed(123)
        returns = np.random.randn(19) * 0.02
        prices_a = 100.0 * np.cumprod(np.concatenate([[1.0], 1 + returns]))
        prices_b = 10000.0 / prices_a
        df1 = pd.DataFrame({"close": prices_a}, index=idx)
        df2 = pd.DataFrame({"close": prices_b}, index=idx)

        matrix, symbols, normalized, meta = _compute_correlation({"A": df1, "B": df2})

        assert matrix is not None
        assert abs(matrix[0][1] - (-1.0)) < 1e-6

    def test_independent_random_series_near_zero(self):
        np.random.seed(42)
        idx = pd.date_range("2026-04-01", periods=500, freq="1D")
        df1 = pd.DataFrame({"close": np.random.randn(500).cumsum() + 100}, index=idx)
        df2 = pd.DataFrame({"close": np.random.randn(500).cumsum() + 100}, index=idx)

        matrix, symbols, normalized, meta = _compute_correlation({"A": df1, "B": df2})

        assert matrix is not None
        assert abs(matrix[0][1]) < 0.15

    def test_single_symbol_returns_identity(self):
        idx = pd.date_range("2026-04-01", periods=10, freq="1D")
        df = pd.DataFrame({"close": np.arange(100.0, 110.0)}, index=idx)

        matrix, symbols, normalized, meta = _compute_correlation({"RELIANCE": df})

        assert matrix == [[1.0]]
        assert symbols == ["RELIANCE"]
        assert "RELIANCE" in normalized
        assert meta["data_points"] == 10

    def test_empty_dict_returns_none(self):
        matrix, symbols, normalized, meta = _compute_correlation({})

        assert matrix is None
        assert symbols is None
        assert normalized is None
        assert meta is None

    def test_single_symbol_normalized_start_at_zero(self):
        idx = pd.date_range("2026-04-01", periods=5, freq="1D")
        df = pd.DataFrame({"close": [100.0, 105.0, 110.0, 108.0, 112.0]}, index=idx)

        matrix, symbols, normalized, meta = _compute_correlation({"TCS": df})

        assert normalized["TCS"][0]["value"] == 0.0
        assert abs(normalized["TCS"][1]["value"] - 5.0) < 0.01
        assert abs(normalized["TCS"][2]["value"] - 10.0) < 0.01

    def test_missing_close_column_excluded(self):
        idx = pd.date_range("2026-04-01", periods=10, freq="1D")
        df1 = pd.DataFrame({"close": np.arange(100.0, 110.0)}, index=idx)
        df2 = pd.DataFrame({"open": np.arange(200.0, 210.0)}, index=idx)

        matrix, symbols, normalized, meta = _compute_correlation({"A": df1, "B": df2})

        assert matrix == [[1.0]]
        assert symbols == ["A"]

    def test_no_overlapping_index_returns_none(self):
        idx1 = pd.date_range("2026-04-01", periods=10, freq="1D")
        idx2 = pd.date_range("2026-05-01", periods=10, freq="1D")
        df1 = pd.DataFrame({"close": np.arange(100.0, 110.0)}, index=idx1)
        df2 = pd.DataFrame({"close": np.arange(200.0, 210.0)}, index=idx2)

        matrix, symbols, normalized, meta = _compute_correlation({"A": df1, "B": df2})

        assert matrix is None

    def test_three_symbols_matrix_shape(self):
        idx = pd.date_range("2026-04-01", periods=30, freq="1D")
        np.random.seed(99)
        dfs = {
            "A": pd.DataFrame({"close": np.random.randn(30).cumsum() + 100}, index=idx),
            "B": pd.DataFrame({"close": np.random.randn(30).cumsum() + 100}, index=idx),
            "C": pd.DataFrame({"close": np.random.randn(30).cumsum() + 100}, index=idx),
        }

        matrix, symbols, normalized, meta = _compute_correlation(dfs)

        assert matrix is not None
        assert len(matrix) == 3
        assert all(len(row) == 3 for row in matrix)
        assert len(symbols) == 3
        assert meta["data_points"] == 30

    def test_null_values_in_returns_produce_valid_matrix(self):
        idx = pd.date_range("2026-04-01", periods=10, freq="1D")
        df1 = pd.DataFrame({"close": [100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0]}, index=idx)
        df2 = pd.DataFrame({"close": np.arange(100.0, 110.0)}, index=idx)

        matrix, symbols, normalized, meta = _compute_correlation({"A": df1, "B": df2})

        assert matrix is not None
        assert len(matrix) == 2
        assert all(all(isinstance(v, (int, float)) for v in row) for row in matrix)


# ---------------------------------------------------------------------------
# _make_cache_key
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestMakeCacheKey:

    def test_same_inputs_same_key(self):
        key1 = _make_cache_key(["RELIANCE", "TCS"], "daily", 30, "days")
        key2 = _make_cache_key(["TCS", "RELIANCE"], "daily", 30, "days")
        assert key1 == key2

    def test_normalizes_to_uppercase(self):
        key1 = _make_cache_key(["reliance", "tcs"], "daily", 30, "days")
        key2 = _make_cache_key(["RELIANCE", "TCS"], "daily", 30, "days")
        assert key1 == key2

    def test_different_timeframe_different_key(self):
        key1 = _make_cache_key(["RELIANCE"], "daily", 30, "days")
        key2 = _make_cache_key(["RELIANCE"], "intraday", 30, "days")
        assert key1 != key2

    def test_different_period_different_key(self):
        key1 = _make_cache_key(["RELIANCE"], "daily", 30, "days")
        key2 = _make_cache_key(["RELIANCE"], "daily", 60, "days")
        assert key1 != key2

    def test_key_format(self):
        key = _make_cache_key(["RELIANCE", "TCS"], "daily", 30, "days")
        assert key == "RELIANCE_TCS_daily_30_days"


# ---------------------------------------------------------------------------
# Cache read/write roundtrip
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestCacheRoundtrip:

    @pytest.fixture
    def cache_dir(self, tmp_path, monkeypatch):
        import api.correlation as mod
        monkeypatch.setattr(mod, "CACHE_DIR", tmp_path)
        return tmp_path

    def test_write_and_read_within_ttl(self, cache_dir):
        data = {"matrix": [[1.0, 0.5], [0.5, 1.0]], "symbols": ["A", "B"], "cached": False}
        _write_cache("test_key", data)
        result = _read_cache("test_key")
        assert result is not None
        assert result["matrix"] == [[1.0, 0.5], [0.5, 1.0]]
        assert result["symbols"] == ["A", "B"]

    def test_read_returns_none_for_missing_key(self, cache_dir):
        result = _read_cache("nonexistent_key")
        assert result is None

    def test_read_returns_none_after_ttl_expiry(self, cache_dir):
        import api.correlation as mod
        data = {"matrix": [[1.0]], "symbols": ["A"]}
        _write_cache("expiry_key", data)

        with patch.object(mod, "time") as mock_time:
            mock_time.time.return_value = time.time() + mod.CACHE_TTL_SECONDS + 1
            result = _read_cache("expiry_key")
            assert result is None

    def test_cache_files_created(self, cache_dir):
        _write_cache("files_key", {"data": 1})
        assert _get_cache_path("files_key").exists()
        assert _get_cache_meta_path("files_key").exists()

    def test_cache_json_content(self, cache_dir):
        data = {"matrix": [[0.95]], "symbols": ["X"], "meta": {"data_points": 50}}
        _write_cache("json_key", data)
        with open(_get_cache_path("json_key"), "r") as f:
            loaded = json.load(f)
        assert loaded == data

    def test_corrupt_meta_doesnt_crash(self, cache_dir):
        data = {"matrix": [[1.0]], "symbols": ["A"]}
        _write_cache("corrupt_key", data)
        _get_cache_meta_path("corrupt_key").write_text("not valid json")
        result = _read_cache("corrupt_key")
        assert result is None

    def test_corrupt_data_doesnt_crash(self, cache_dir):
        _get_cache_path("bad_data_key").write_text("not json")
        _get_cache_meta_path("bad_data_key").write_text(json.dumps({"ts": time.time()}))
        result = _read_cache("bad_data_key")
        assert result is None


# ---------------------------------------------------------------------------
# Endpoint validation
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestCorrelationEndpoint:

    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient
        from api.correlation import router
        from fastapi import FastAPI
        app = FastAPI()
        app.include_router(router)
        return TestClient(app)

    def test_empty_symbols_returns_400(self, client):
        response = client.post("/api/correlation/", json={"symbols": []})
        assert response.status_code == 400

    def test_whitespace_only_symbols_returns_400(self, client):
        response = client.post("/api/correlation/", json={"symbols": ["  ", ""]})
        assert response.status_code == 400

    def test_invalid_timeframe_returns_400(self, client):
        response = client.post("/api/correlation/", json={"symbols": ["RELIANCE"], "timeframe": "weekly"})
        assert response.status_code == 400

    def test_invalid_period_unit_returns_400(self, client):
        response = client.post("/api/correlation/", json={"symbols": ["RELIANCE"], "period_unit": "weeks"})
        assert response.status_code == 400

    def test_negative_period_returns_400(self, client):
        response = client.post("/api/correlation/", json={"symbols": ["RELIANCE"], "period": -5})
        assert response.status_code == 400

    def test_zero_period_returns_400(self, client):
        response = client.post("/api/correlation/", json={"symbols": ["RELIANCE"], "period": 0})
        assert response.status_code == 400

    def test_valid_request_with_mocked_api(self, client, monkeypatch, tmp_path):
        import api.correlation as mod
        monkeypatch.setattr(mod, "CACHE_DIR", tmp_path)
        monkeypatch.setattr(mod, "UPSTOX_API_KEY", "test_key")
        monkeypatch.setattr(mod, "UPSTOX_API_SECRET", "test_secret")

        idx = pd.date_range("2026-04-01", periods=30, freq="1D")
        df = pd.DataFrame({
            "open": np.arange(100.0, 130.0),
            "high": np.arange(101.0, 131.0),
            "low": np.arange(99.0, 129.0),
            "close": np.arange(100.0, 130.0),
            "volume": [1000] * 30,
        }, index=idx)

        mock_api = MagicMock()
        mock_api.fetch_historical_data_v3.return_value = df

        with patch.object(mod, "UpstoxAPI", return_value=mock_api):
            response = client.post("/api/correlation/", json={
                "symbols": ["RELIANCE", "TCS"],
                "timeframe": "daily",
                "period": 30,
                "period_unit": "days",
            })

        assert response.status_code == 200
        body = response.json()
        assert "matrix" in body
        assert "symbols" in body
        assert "normalized" in body
        assert body["cached"] is False

    def test_cache_hit_returns_cached_true(self, client, monkeypatch, tmp_path):
        import api.correlation as mod
        monkeypatch.setattr(mod, "CACHE_DIR", tmp_path)
        monkeypatch.setattr(mod, "UPSTOX_API_KEY", "test_key")
        monkeypatch.setattr(mod, "UPSTOX_API_SECRET", "test_secret")

        cached_data = {
            "matrix": [[1.0, 0.8], [0.8, 1.0]],
            "symbols": ["RELIANCE", "TCS"],
            "normalized": {},
            "meta": {"start_date": "2026-04-01", "end_date": "2026-04-30", "data_points": 30},
            "cached": False,
        }
        _write_cache("RELIANCE_TCS_daily_30_days", cached_data)

        response = client.post("/api/correlation/", json={
            "symbols": ["RELIANCE", "TCS"],
            "timeframe": "daily",
            "period": 30,
            "period_unit": "days",
        })

        assert response.status_code == 200
        body = response.json()
        assert body["cached"] is True
        assert body["matrix"] == [[1.0, 0.8], [0.8, 1.0]]

    def test_insufficient_data_returns_warning(self, client, monkeypatch, tmp_path):
        import api.correlation as mod
        monkeypatch.setattr(mod, "CACHE_DIR", tmp_path)
        monkeypatch.setattr(mod, "UPSTOX_API_KEY", "test_key")
        monkeypatch.setattr(mod, "UPSTOX_API_SECRET", "test_secret")

        mock_api = MagicMock()
        mock_api.fetch_historical_data_v3.return_value = None

        with patch.object(mod, "UpstoxAPI", return_value=mock_api):
            response = client.post("/api/correlation/", json={
                "symbols": ["RELIANCE", "TCS"],
                "timeframe": "daily",
                "period": 30,
                "period_unit": "days",
            })

        assert response.status_code == 200
        body = response.json()
        assert "warning" in body
        assert body["matrix"] == []

    def test_missing_credentials_returns_500(self, client, monkeypatch):
        monkeypatch.setattr("api.correlation.UPSTOX_API_KEY", None)
        monkeypatch.setattr("api.correlation.UPSTOX_API_SECRET", "test_secret")

        response = client.post("/api/correlation/", json={"symbols": ["RELIANCE"]})
        assert response.status_code == 500

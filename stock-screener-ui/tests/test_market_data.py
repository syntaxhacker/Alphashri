"""Tests for market_data — fetch_candles, resample_candles."""

import sys
from pathlib import Path
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from market_data.market_data import (
    fetch_candles,
    resample_candles,
    _normalize_tz,
    _TF_TO_UPSTOX,
    _RESAMPLE_RULE,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_1m_candles(n: int, base_price: float = 100.0, start: str = "2026-04-09 09:15:00"):
    """Create n 1-minute candles as a DataFrame with IST timezone."""
    from zoneinfo import ZoneInfo
    ist = ZoneInfo("Asia/Kolkata")
    times = pd.date_range(start, periods=n, freq="1min", tz=ist)
    import numpy as np
    np.random.seed(42)
    closes = base_price + np.cumsum(np.random.randn(n) * 0.1)
    data = {
        "open": closes - 0.05,
        "high": closes + 0.1,
        "low": closes - 0.1,
        "close": closes,
        "volume": [1000] * n,
        "oi": [0] * n,
    }
    return pd.DataFrame(data, index=times)


# ---------------------------------------------------------------------------
# _normalize_tz
# ---------------------------------------------------------------------------

class TestNormalizeTz:
    def test_naive_index_gets_utc(self):
        df = pd.DataFrame({"close": [1.0]}, index=pd.DatetimeIndex(["2026-04-09"], tz=None))
        result = _normalize_tz(df)
        assert result.index.tz is not None
        assert str(result.index.tz) == "UTC"

    def test_utc_index_stays_utc(self):
        idx = pd.DatetimeIndex(["2026-04-09"], tz="UTC")
        df = pd.DataFrame({"close": [1.0]}, index=idx)
        result = _normalize_tz(df)
        assert str(result.index.tz) == "UTC"

    def test_non_utc_gets_converted(self):
        idx = pd.DatetimeIndex(["2026-04-09 09:15:00"], tz="US/Eastern")
        df = pd.DataFrame({"close": [1.0]}, index=idx)
        result = _normalize_tz(df)
        assert str(result.index.tz) == "UTC"


# ---------------------------------------------------------------------------
# resample_candles
# ---------------------------------------------------------------------------

class TestResampleCandles:
    def test_1m_to_5m(self):
        df = _make_1m_candles(75)
        result = resample_candles(df, 5)
        assert len(result) == 15
        assert all(c in result.columns for c in ["open", "high", "low", "close", "volume"])

    def test_1m_to_15m(self):
        df = _make_1m_candles(75)
        result = resample_candles(df, 15)
        assert len(result) == 5

    def test_1m_to_1h(self):
        df = _make_1m_candles(375)
        result = resample_candles(df, 60)
        assert len(result) == 7  # 09:15-15:30 IST → 7 hourly buckets (09,10,11,12,13,14,15)

    def test_resample_preserves_tz(self):
        idx = pd.DatetimeIndex(["2026-04-09 09:15:00"], tz="UTC")
        df = pd.DataFrame({"close": [1.0], "open": [1.0], "high": [1.0], "low": [1.0], "volume": [1.0]}, index=idx)
        result = resample_candles(df, 5)
        assert str(result.index.tz) == "UTC"

    def test_empty_df(self):
        df = pd.DataFrame()
        result = resample_candles(df, 5)
        assert result.empty

    def test_high_is_max_of_group(self):
        df = pd.DataFrame(
            {"open": [100, 101, 102], "high": [103, 105, 104], "low": [99, 100, 101], "close": [101, 102, 103], "volume": [10, 20, 30]},
            index=pd.date_range("2026-04-09 09:15", periods=3, freq="1min", tz="UTC"),
        )
        result = resample_candles(df, 5)
        assert result["high"].iloc[0] == 105.0
        assert result["low"].iloc[0] == 99.0
        assert result["volume"].iloc[0] == 60

    def test_same_tf_returns_same_count(self):
        df = _make_1m_candles(10)
        result = resample_candles(df, 1)
        assert len(result) == 10


# ---------------------------------------------------------------------------
# fetch_candles
# ---------------------------------------------------------------------------

class TestFetchCandles:
    @patch("market_data.market_data.get_api_client")
    def test_invalid_tf_raises(self, mock_client):
        with pytest.raises(ValueError, match="Unsupported tf"):
            fetch_candles("RELIANCE", tf=999, from_date="2026-04-09", to_date="2026-04-09")

    @patch("market_data.market_data.get_api_client", return_value=None)
    def test_no_client_returns_none(self, mock_client):
        result = fetch_candles("RELIANCE", tf=5, from_date="2026-04-09", to_date="2026-04-09")
        assert result is None

    @patch("market_data.market_data.get_api_client")
    def test_historical_path(self, mock_client):
        mock_api = MagicMock()
        mock_client.return_value = mock_api
        mock_api.fetch_historical_data_v3.return_value = _make_1m_candles(10)

        result = fetch_candles("RELIANCE", tf=1, from_date="2026-04-07", to_date="2026-04-09")

        mock_api.fetch_historical_data_v3.assert_called_once()
        assert result is not None
        assert len(result) == 10

    @patch("market_data.market_data.get_api_client")
    def test_intraday_path_today(self, mock_client):
        mock_api = MagicMock()
        mock_client.return_value = mock_api
        mock_api.fetch_intraday_data_v3.return_value = _make_1m_candles(10)

        today = datetime.now().strftime("%Y-%m-%d")
        result = fetch_candles("RELIANCE", tf=1, from_date=today, to_date=today)

        mock_api.fetch_intraday_data_v3.assert_called_once()
        assert result is not None

    @patch("market_data.market_data.get_api_client")
    def test_resample_to(self, mock_client):
        mock_api = MagicMock()
        mock_client.return_value = mock_api
        mock_api.fetch_historical_data_v3.return_value = _make_1m_candles(75)

        result = fetch_candles("RELIANCE", tf=1, from_date="2026-04-09", to_date="2026-04-09", resample_to=15)

        assert result is not None
        assert len(result) == 5  # 75 / 15 = 5

    @patch("market_data.market_data.get_api_client")
    def test_none_result_returns_none(self, mock_client):
        mock_api = MagicMock()
        mock_client.return_value = mock_api
        mock_api.fetch_historical_data_v3.return_value = None

        result = fetch_candles("RELIANCE", tf=5, from_date="2026-04-09", to_date="2026-04-09")
        assert result is None

    @patch("market_data.market_data.get_api_client")
    def test_explicit_api_client(self, mock_client):
        mock_api = MagicMock()
        mock_api.fetch_historical_data_v3.return_value = _make_1m_candles(5)

        result = fetch_candles("RELIANCE", tf=5, from_date="2026-04-09", to_date="2026-04-09", api_client=mock_api)

        mock_api.fetch_historical_data_v3.assert_called_once()
        mock_client.assert_not_called()


# ---------------------------------------------------------------------------
# _TF_TO_UPSTOX mapping
# ---------------------------------------------------------------------------

class TestTFMapping:
    def test_all_tfs_have_mappings(self):
        for tf in [1, 5, 15, 30, 60, 1440]:
            assert tf in _TF_TO_UPSTOX, f"Missing mapping for tf={tf}"

    def test_mapping_values(self):
        assert _TF_TO_UPSTOX[1] == ("minutes", 1)
        assert _TF_TO_UPSTOX[5] == ("minutes", 5)
        assert _TF_TO_UPSTOX[15] == ("minutes", 15)
        assert _TF_TO_UPSTOX[60] == ("hours", 1)
        assert _TF_TO_UPSTOX[1440] == ("days", 1)

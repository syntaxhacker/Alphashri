"""
Chart Cache Tests.

Tests for api/paper/chart_cache.py — get_cached_candles and save_cached_candles.
"""

import pytest
import pickle
import pandas as pd
from pathlib import Path


@pytest.fixture
def cache_dir(tmp_path):
    """Provide a temp directory as the chart cache dir."""
    return tmp_path


@pytest.fixture
def patched_cache_dir(cache_dir, monkeypatch):
    """Patch CACHE_DIR to use temp directory."""
    import api.paper.chart_cache as mod
    monkeypatch.setattr(mod, "CACHE_DIR", cache_dir)
    return cache_dir


@pytest.mark.unit
class TestChartCache:

    def test_get_cached_candles_returns_none_for_nonexistent_file(self, patched_cache_dir):
        from api.paper.chart_cache import get_cached_candles
        result, is_cached = get_cached_candles("RELIANCE", "2026-04-15")
        assert result is None
        assert is_cached is False

    def test_save_and_get_cached_candles_roundtrip(self, patched_cache_dir):
        from api.paper.chart_cache import save_cached_candles, get_cached_candles
        df = pd.DataFrame({
            "open": [100.0, 101.0, 102.0],
            "high": [102.0, 103.0, 104.0],
            "low": [99.0, 100.0, 101.0],
            "close": [101.0, 102.0, 103.0],
            "volume": [1000, 1100, 1200],
        }, index=pd.date_range("2026-04-15 09:15", periods=3, freq="1min"))

        save_cached_candles("RELIANCE", "2026-04-15", df)
        result, is_cached = get_cached_candles("RELIANCE", "2026-04-15")

        assert result is not None
        assert is_cached is True
        pd.testing.assert_frame_equal(result, df)

    def test_save_cached_candles_with_empty_df_does_not_save(self, patched_cache_dir):
        from api.paper.chart_cache import save_cached_candles
        empty_df = pd.DataFrame()

        save_cached_candles("RELIANCE", "2026-04-15", empty_df)

        cache_file = patched_cache_dir / "2026-04-15" / "RELIANCE.pkl"
        assert not cache_file.exists()

    def test_get_cached_candles_returns_none_for_corrupt_pickle(self, patched_cache_dir):
        from api.paper.chart_cache import get_cached_candles
        cache_file = patched_cache_dir / "2026-04-15" / "RELIANCE.pkl"
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.write_bytes(b"this is not a valid pickle file")

        result, is_cached = get_cached_candles("RELIANCE", "2026-04-15")
        assert result is None
        assert is_cached is False

    def test_get_cached_candles_returns_none_for_empty_dataframe(self, patched_cache_dir):
        from api.paper.chart_cache import save_cached_candles, get_cached_candles
        df = pd.DataFrame({"open": [], "high": [], "low": [], "close": [], "volume": []})

        save_cached_candles("RELIANCE", "2026-04-15", df)

        result, is_cached = get_cached_candles("RELIANCE", "2026-04-15")
        assert result is None
        assert is_cached is False

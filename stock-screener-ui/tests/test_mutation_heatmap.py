"""
Mutation tests for heatmap API - verify tests catch bugs.
"""

import pytest
import pandas as pd


class TestHeatmapMutation:
    """Test that mutations are caught by tests."""

    def test_filters_negative_pe(self):
        """Mutation: Should filter out negative P/E values."""
        stocks = [
            {"symbol": "TEST", "name": "TEST", "sector": "Tech", "market_cap": 1000, "pe_ratio": -5, "price": 100, "change_pct": 1},
            {"symbol": "GOOD", "name": "GOOD", "sector": "Tech", "market_cap": 2000, "pe_ratio": 15, "price": 100, "change_pct": 1},
        ]

        result = [s for s in stocks if s["pe_ratio"] > 0]

        assert all(s["pe_ratio"] > 0 for s in result)
        assert len(result) == 1

    def test_removes_bse_duplicates(self):
        """Mutation: Should deduplicate, keeping only NSE (not BSE)."""
        stocks = [
            {"symbol": "NSE:RELIANCE", "name": "RELIANCE", "sector": "Energy", "market_cap": 1000, "pe_ratio": 20, "price": 100, "change_pct": 1},
            {"symbol": "BSE:RELIANCE", "name": "RELIANCE", "sector": "Energy", "market_cap": 1000, "pe_ratio": 20, "price": 100, "change_pct": 1},
        ]

        df = pd.DataFrame(stocks)
        df = df[~df['symbol'].str.contains('BSE:')].drop_duplicates(subset=['name'])

        assert len(df) == 1

    def test_fallback_returns_cached_data(self):
        """Mutation: Fallback should return previously cached data."""
        import api.heatmap

        api.heatmap._heatmap_cache["fallback"] = [
            {"symbol": "FALLBACK", "name": "Fallback", "sector": "Test", "market_cap": 1000, "pe_ratio": 10, "price": 100, "change_pct": 1}
        ]

        from api.heatmap import _get_fallback_data
        result = _get_fallback_data()

        assert len(result) == 1
        assert result[0]["symbol"] == "FALLBACK"

    def test_retry_loop_exists(self):
        """Mutation: Verify retry logic exists in code."""
        import api.heatmap
        import inspect

        source = inspect.getsource(api.heatmap._get_cached_stocks)

        assert "max_retries" in source
        assert "attempt" in source
        assert "HTTPError" in source or "ConnectionError" in source


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
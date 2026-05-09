"""Tests for market_data error handling — Cloudflare, token expiry, missing keys."""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from market_data.market_data import fetch_candles


class TestMarketDataErrorHandling:
    """Tests for HTTP error handling in Upstox API v3 calls."""

    @patch("market_data.market_data.get_api_client")
    def test_cloudflare_1015_block(self, mock_get_client):
        """Test handling of Cloudflare 1015 / HTTP 429."""
        mock_api = MagicMock()
        mock_get_client.return_value = mock_api
        mock_api.fetch_intraday_data_v3.side_effect = Exception(
            "HTTP 429: Cloudflare 1015 - Blocked"
        )

        from datetime import datetime
        today = datetime.now().strftime("%Y-%m-%d")
        result = fetch_candles("RELIANCE", tf=1, from_date=today, to_date=today)

        assert result is None

    @patch("market_data.market_data.get_api_client")
    def test_token_expiry_401(self, mock_get_client):
        """Test handling of token expiry HTTP 401."""
        mock_api = MagicMock()
        mock_get_client.return_value = mock_api
        mock_api.fetch_intraday_data_v3.side_effect = Exception(
            "HTTP 401: Token expired"
        )

        from datetime import datetime
        today = datetime.now().strftime("%Y-%m-%d")
        result = fetch_candles("RELIANCE", tf=1, from_date=today, to_date=today)

        assert result is None

    @patch("market_data.market_data.get_api_client")
    def test_missing_instrument_key_404(self, mock_get_client):
        """Test handling of missing instrument key HTTP 404."""
        mock_api = MagicMock()
        mock_get_client.return_value = mock_api
        mock_api.fetch_intraday_data_v3.side_effect = Exception(
            "HTTP 404: Instrument key not found"
        )

        from datetime import datetime
        today = datetime.now().strftime("%Y-%m-%d")
        result = fetch_candles("RELIANCE", tf=1, from_date=today, to_date=today)

        assert result is None

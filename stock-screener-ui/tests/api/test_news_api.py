"""
Tests for News Analyzer FastAPI endpoints.

Test cases cover:
- /api/news/analyze
- /api/news/sentiment/{symbol}
"""
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock, Mock
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

if 'news_api' not in sys.modules:
    news_api_stub = MagicMock()
    news_api_stub.fetch_article_content = MagicMock()
    news_api_stub._aggregator = MagicMock()
    news_api_stub._aggregator.fetch_all = MagicMock(return_value=[])
    sys.modules['news_api'] = news_api_stub

from api_server_fastapi import app
from fastapi.testclient import TestClient

import api_server_fastapi
api_server_fastapi._news_available = True
api_server_fastapi._llm_available = True

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clear_news_cache():
    """Clear any cached news analysis between tests."""
    try:
        from cache.redis_client import cache_get, _cache_store
        if hasattr(_cache_store, 'clear'):
            _cache_store.clear()
    except Exception:
        pass
    yield


class TestNewsEndpoints:

    @patch('api_server_fastapi.fetch_article_content')
    @patch('api_server_fastapi.article_analyzer')
    def test_analyze_endpoint_success(self, mock_analyzer, mock_fetcher):
        """Verify the /api/news/analyze endpoint stitches fetched content and AI analysis together."""

        mock_fetcher.return_value = {
            "id": "123",
            "headline": "Test Market Rally",
            "description": "The market is doing well.",
            "sourceUrl": "http://test.com"
        }

        mock_analyzer.analyze_article.return_value = {
            "summary": "AI Summary",
            "sentiment": "BULLISH",
            "impact_score": 9,
            "key_entities": ["Market"],
            "trade_ideas": []
        }

        response = client.get("/api/news/analyze?url=http://test.com")

        assert response.status_code == 200
        data = response.json()

        assert "headline" in data
        assert data["headline"] == "Test Market Rally"

        assert "analysis" in data
        assert data["analysis"]["sentiment"] == "BULLISH"
        assert data["analysis"]["impact_score"] == 9

    @patch('api_server_fastapi.fetch_article_content')
    @patch('api_server_fastapi.article_analyzer')
    def test_analyze_endpoint_fetch_error(self, mock_analyzer, mock_fetcher):
        """Verify errors during article scraping are handled gracefully."""
        mock_fetcher.return_value = {
            "error": "Site blocked",
            "sourceUrl": "http://blocked.com"
        }

        response = client.get("/api/news/analyze?url=http://blocked.com")
        assert response.status_code == 500
        assert "Site blocked" in response.json()["detail"]


@pytest.fixture
def mock_news_aggregator(monkeypatch):
    """Fixture to mock the global NewsAggregator."""
    import news_api
    class MockAggregator:
        def fetch_all(self, limit_per_source=15):
             return [
                 {'sourceUrl': 'http://url1.com'},
                 {'sourceUrl': 'http://url2.com'}
             ]
    monkeypatch.setattr(news_api, '_aggregator', MockAggregator())


class TestSentimentEndpoint:

    def test_symbol_sentiment_success(self, mock_news_aggregator):
        """Verify the /api/news/sentiment/{symbol} endpoint aggregates properly."""
        with patch('api_server_fastapi._news_available', True), \
             patch('api_server_fastapi._llm_available', True), \
             patch('api_server_fastapi.fetch_article_content') as mock_fetcher, \
             patch('api_server_fastapi.article_analyzer') as mock_analyzer:

            def side_effect_fetch(url):
                if "url1" in url:
                    return {
                        "headline": "Reliance hits high",
                        "description": "Good news today",
                        "publishedAt": "2026-01-01"
                    }
                return {
                    "headline": "Reliance faces issues",
                    "description": "Bad times.",
                    "publishedAt": "2026-01-02"
                }

            mock_fetcher.side_effect = side_effect_fetch

            def side_effect_analyze(url, headline, content):
                if "high" in headline:
                    return {"impact_score": 10, "sentiment": "BULLISH", "trade_ideas": []}
                return {"impact_score": 2, "sentiment": "BEARISH", "trade_ideas": []}

            mock_analyzer.analyze_article.side_effect = side_effect_analyze

            response = client.get("/api/news/sentiment/RELIANCE")

            assert response.status_code == 200
            data = response.json()

            assert data["symbol"] == "RELIANCE"
            assert data["articles_analyzed"] == 2
            assert data["sentiment_score"] == 40.0
            assert data["sentiment_label"] == "BULLISH"

    def test_symbol_sentiment_no_news(self, mock_news_aggregator):
        """Verify the endpoint returns a clean NO_RECENT_NEWS status if the symbol isn't in top news."""
        with patch('api_server_fastapi._news_available', True), \
             patch('api_server_fastapi._llm_available', True), \
             patch('api_server_fastapi.fetch_article_content') as mock_fetcher:

            mock_fetcher.return_value = {
                "headline": "Other company news",
                "description": "Nothing happening",
                "symbols": []
            }

            response = client.get("/api/news/sentiment/ITC")
            assert response.status_code == 200
            data = response.json()

            assert data["status"] == "NO_RECENT_NEWS"
            assert data["articles_analyzed"] == 0
            assert data["sentiment_score"] == 0

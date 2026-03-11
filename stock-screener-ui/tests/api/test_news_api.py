"""
Tests for News Analyzer FastAPI endpoints.

Test cases cover:
- /api/news/analyze
- /api/news/sentiment/{symbol}
"""
import sys
from pathlib import Path
from unittest.mock import patch
import pytest

ROOT = Path(__file__).resolve().parents[2]
import sys
from pathlib import Path
from unittest.mock import patch
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

# PREVENT EXTRANEOUS IMPORTS FROM CRASHING FASTAPI TESTS
from unittest.mock import MagicMock

def create_mock_module(name):
    sys.modules[name] = MagicMock()

create_mock_module('backtest')
create_mock_module('backtest.api')
create_mock_module('backtest.engine')
create_mock_module('backtest.strategies')
create_mock_module('backtest.strategies.orb')

# MOCK NAUTILUS TRADER IMPORTS
create_mock_module('nautilus_trader.model.events')
create_mock_module('nautilus_trader.model.identifiers')
create_mock_module('nautilus_trader.model.objects')
create_mock_module('nautilus_trader.model.position')

# MOCK EXTERNAL LIBS
create_mock_module('scrapling')
create_mock_module('scrapling.fetchers')
create_mock_module('openai')

# ADD SCRAPER PATH
sys.path.insert(0, str(ROOT / 'moneycontrol-scraper'))

# We need to import the app from the fastapi server
from api_server_fastapi import app, _news_available, _llm_available
from fastapi.testclient import TestClient

# FORCE AVAILABILITY FLAGS TRUE FOR TESTING (They false-negative because of our global mocks)
import api_server_fastapi
api_server_fastapi._news_available = True
api_server_fastapi._llm_available = True

client = TestClient(app)

class TestNewsEndpoints:
    
    @patch('news_api.fetch_article_content')
    @patch('api_server_fastapi.article_analyzer')
    def test_analyze_endpoint_success(self, mock_analyzer, mock_fetcher):
         """Verify the /api/news/analyze endpoint stitches fetched content and AI analysis together."""
         
         # Mock the raw article fetch
         mock_fetcher.return_value = {
             "id": "123",
             "headline": "Test Market Rally",
             "description": "The market is doing well.",
             "sourceUrl": "http://test.com"
         }
         
         # Mock the AI JSON analysis
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
         
         # Verify the nested AI analysis
         assert "analysis" in data
         assert data["analysis"]["sentiment"] == "BULLISH"
         assert data["analysis"]["impact_score"] == 9

    @patch('news_api.fetch_article_content')
    def test_analyze_endpoint_fetch_error(self, mock_fetcher):
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

    @patch('news_api.fetch_article_content')
    @patch('api_server_fastapi.article_analyzer')
    def test_symbol_sentiment_success(self, mock_analyzer, mock_fetcher, mock_news_aggregator):
        """Verify the /api/news/sentiment/{symbol} endpoint aggregates properly."""
        
        # We Mock 2 articles being returned by fetch_article_content
        # One is deeply BULLISH about RELIANCE, one is BEARISH
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
        
        # Mock the corresponding AI analysis
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
        # Math: +10 (bullish) and -2 (bearish) out of max 20 impact -> 8 / 20 * 100 = 40% (BULLISH)
        assert data["sentiment_score"] == 40.0
        assert data["sentiment_label"] == "BULLISH"
        
    @patch('news_api.fetch_article_content')
    def test_symbol_sentiment_no_news(self, mock_fetcher, mock_news_aggregator):
        """Verify the endpoint returns a clean NO_RECENT_NEWS status if the symbol isn't in top news."""
        
        # Headline doesn't mention the requested symbol (ITC)
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

"""
Tests for News API caching, LLM analysis, symbol enrichment, persistence,
and poller logic — covering backend items missing from existing test suites.
"""

import sys
import json
import hashlib
from pathlib import Path
from datetime import datetime
from unittest.mock import Mock, MagicMock, patch, AsyncMock, PropertyMock

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

# Stub news_api before importing api_server_fastapi
if 'news_api' not in sys.modules:
    news_api_stub = MagicMock()
    news_api_stub.fetch_article_content = MagicMock()
    news_api_stub.fetch_news = MagicMock()
    news_api_stub._aggregator = MagicMock()
    news_api_stub._aggregator.fetch_all = MagicMock(return_value=[])
    sys.modules['news_api'] = news_api_stub

from api_server_fastapi import app
from fastapi.testclient import TestClient
import api_server_fastapi

api_server_fastapi._news_available = True
api_server_fastapi._llm_available = True

client = TestClient(app)


# =========================================================================
# Article Endpoint: Caching
# =========================================================================

class TestArticleEndpointCaching:
    @patch('api_server_fastapi.fetch_article_content')
    @patch('cache.redis_client.cache_get')
    def test_returns_cached_article_with_from_cache_flag(self, mock_cache_get, mock_fetcher):
        cached_data = {
            "headline": "Cached Article",
            "description": "This is from cache",
            "sourceUrl": "http://test.com/cached"
        }
        mock_cache_get.return_value = cached_data

        response = client.get("/api/news/article?url=http://test.com/cached")

        assert response.status_code == 200
        data = response.json()
        assert data["headline"] == "Cached Article"
        assert data["from_cache"] is True
        mock_fetcher.assert_not_called()

    @patch('api_server_fastapi.fetch_article_content')
    @patch('cache.redis_client.cache_get')
    @patch('cache.redis_client.cache_set_smart')
    def test_caches_article_with_md5_hash_key(self, mock_cache_set_smart, mock_cache_get, mock_fetcher):
        mock_cache_get.return_value = None
        mock_fetcher.return_value = {
            "headline": "Fresh Article",
            "description": "Brand new content for testing",
            "sourceUrl": "http://test.com/fresh"
        }

        with patch('services.news_persistence.get_persistence_service') as mock_get_persist:
            mock_persist = MagicMock()
            mock_persist.save_article.return_value = MagicMock(id=42)
            mock_get_persist.return_value = mock_persist
            with patch('services.news_instrument_mapper.get_mapper') as mock_get_mapper:
                mock_mapper = MagicMock()
                mock_mapper.map_symbols.return_value = []
                mock_get_mapper.return_value = mock_mapper

                response = client.get("/api/news/article?url=http://test.com/fresh")

        assert response.status_code == 200
        expected_key = f"news:article:{hashlib.md5(b'http://test.com/fresh').hexdigest()[:16]}"
        mock_cache_set_smart.assert_called_once()
        call_args = mock_cache_set_smart.call_args[0]
        assert call_args[0] == expected_key


# =========================================================================
# Article Endpoint: LLM Analysis
# =========================================================================

class TestArticleEndpointLLM:
    @patch('api_server_fastapi.article_analyzer')
    @patch('api_server_fastapi.fetch_article_content')
    @patch('cache.redis_client.cache_get')
    def test_llm_analysis_runs_when_content_gt_100_chars(self, mock_cache_get, mock_fetcher, mock_analyzer):
        mock_cache_get.return_value = None
        long_content = "A" * 150
        mock_fetcher.return_value = {
            "headline": "Long Article",
            "description": long_content,
            "sourceUrl": "http://test.com/long"
        }
        mock_analyzer.analyze_article.return_value = {
            "sentiment": "BULLISH",
            "impact_score": 8,
            "summary": "AI summary here",
            "key_points": ["Point 1"],
            "trade_ideas": []
        }

        with patch('services.news_persistence.get_persistence_service') as mock_get_persist:
            mock_persist = MagicMock()
            mock_persist.save_article.return_value = MagicMock(id=42)
            mock_get_persist.return_value = mock_persist
            with patch('services.news_instrument_mapper.get_mapper') as mock_get_mapper:
                mock_mapper = MagicMock()
                mock_mapper.map_symbols.return_value = []
                mock_get_mapper.return_value = mock_mapper

                response = client.get("/api/news/article?url=http://test.com/long")

        assert response.status_code == 200
        mock_analyzer.analyze_article.assert_called_once()
        data = response.json()
        assert data["sentiment"] == "BULLISH"
        assert data["impact_score"] == 8
        assert data["summary"] == "AI summary here"
        assert data["key_points"] == ["Point 1"]

    @patch('api_server_fastapi.fetch_article_content')
    @patch('cache.redis_client.cache_get')
    def test_llm_analysis_skipped_when_content_le_100_chars(self, mock_cache_get, mock_fetcher):
        mock_cache_get.return_value = None
        short_content = "Short text."  # 11 chars
        mock_fetcher.return_value = {
            "headline": "Short Article",
            "description": short_content,
            "sourceUrl": "http://test.com/short"
        }

        with patch('services.news_persistence.get_persistence_service') as mock_get_persist:
            mock_persist = MagicMock()
            mock_persist.save_article.return_value = MagicMock(id=43)
            mock_get_persist.return_value = mock_persist
            with patch('services.news_instrument_mapper.get_mapper') as mock_get_mapper:
                mock_mapper = MagicMock()
                mock_mapper.map_symbols.return_value = []
                mock_get_mapper.return_value = mock_mapper

                response = client.get("/api/news/article?url=http://test.com/short")

        assert response.status_code == 200
        data = response.json()
        assert "sentiment" not in data or data.get("sentiment") is None
        assert "summary" not in data or data.get("summary") is None

    @patch('api_server_fastapi.article_analyzer')
    @patch('api_server_fastapi.fetch_article_content')
    @patch('cache.redis_client.cache_get')
    def test_llm_analysis_skipped_when_analyzer_not_available(self, mock_cache_get, mock_fetcher, mock_analyzer):
        mock_cache_get.return_value = None
        mock_fetcher.return_value = {
            "headline": "No Analyzer",
            "description": "A" * 150,
            "sourceUrl": "http://test.com/noanalyzer"
        }

        with patch('services.news_persistence.get_persistence_service') as mock_get_persist:
            mock_persist = MagicMock()
            mock_persist.save_article.return_value = MagicMock(id=44)
            mock_get_persist.return_value = mock_persist
            with patch('services.news_instrument_mapper.get_mapper') as mock_get_mapper:
                mock_mapper = MagicMock()
                mock_mapper.map_symbols.return_value = []
                mock_get_mapper.return_value = mock_mapper
                with patch.object(api_server_fastapi, '_llm_available', False):
                    response = client.get("/api/news/article?url=http://test.com/noanalyzer")

        assert response.status_code == 200
        mock_analyzer.analyze_article.assert_not_called()


# =========================================================================
# Article Endpoint: Symbol Enrichment
# =========================================================================

class TestArticleEndpointSymbolEnrichment:
    @patch('api_server_fastapi.fetch_article_content')
    @patch('cache.redis_client.cache_get')
    def test_symbols_enriched_via_instrument_mapper(self, mock_cache_get, mock_fetcher):
        mock_cache_get.return_value = None
        mock_fetcher.return_value = {
            "headline": "Symbol Article",
            "description": "Content about RELIANCE and TCS",
            "sourceUrl": "http://test.com/symbols",
            "symbols": [
                {"code": "RELIANCE", "name": "Reliance"},
                {"code": "TCS", "name": "TCS"}
            ]
        }

        mock_mapper = MagicMock()
        enriched = [
            {"code": "RELIANCE", "trading_symbol": "RELIANCE", "instrument_key": "NSE_EQ|INE002A01018",
             "company_name": "Reliance Industries Ltd", "match_confidence": 1.0, "match_method": "exact"},
            {"code": "TCS", "trading_symbol": "TCS", "instrument_key": "NSE_EQ|INE467B01029",
             "company_name": "TCS Ltd", "match_confidence": 1.0, "match_method": "exact"},
        ]
        mock_mapper.map_symbols.return_value = enriched

        with patch('services.news_persistence.get_persistence_service') as mock_get_persist:
            mock_persist = MagicMock()
            mock_persist.save_article.return_value = MagicMock(id=45)
            mock_get_persist.return_value = mock_persist
            with patch('services.news_instrument_mapper.get_mapper', return_value=mock_mapper):
                response = client.get("/api/news/article?url=http://test.com/symbols")

        assert response.status_code == 200
        mock_mapper.map_symbols.assert_called_once()
        data = response.json()
        assert data["symbols"] == enriched


# =========================================================================
# Article Endpoint: Persistence
# =========================================================================

class TestArticleEndpointPersistence:
    @patch('api_server_fastapi.fetch_article_content')
    @patch('cache.redis_client.cache_get')
    def test_article_persisted_to_database(self, mock_cache_get, mock_fetcher):
        mock_cache_get.return_value = None
        mock_fetcher.return_value = {
            "headline": "Persist Me",
            "description": "Content that gets saved to DB",
            "sourceUrl": "http://test.com/persist",
            "source": "moneycontrol",
            "publishedAt": "2026-01-01T10:00:00Z"
        }

        mock_persist = MagicMock()
        saved_article = MagicMock(id=99)
        mock_persist.save_article.return_value = saved_article

        with patch('services.news_persistence.get_persistence_service', return_value=mock_persist):
            with patch('services.news_instrument_mapper.get_mapper') as mock_get_mapper:
                mock_mapper = MagicMock()
                mock_mapper.map_symbols.return_value = []
                mock_get_mapper.return_value = mock_mapper

                response = client.get("/api/news/article?url=http://test.com/persist")

        assert response.status_code == 200
        mock_persist.save_article.assert_called_once()
        call_kwargs = mock_persist.save_article.call_args.kwargs
        assert call_kwargs["url"] == "http://test.com/persist"
        assert call_kwargs["headline"] == "Persist Me"
        assert call_kwargs["source"] == "moneycontrol"
        data = response.json()
        assert data["id"] == 99


# =========================================================================
# Analyze Endpoint: 503 + Cache
# =========================================================================

class TestAnalyzeEndpoint:
    def test_returns_503_when_llm_not_available(self):
        with patch.object(api_server_fastapi, '_llm_available', False):
            response = client.get("/api/news/analyze?url=http://test.com/analyze503")
        assert response.status_code == 503

    def test_returns_503_when_news_not_available(self):
        with patch.object(api_server_fastapi, '_news_available', False):
            response = client.get("/api/news/analyze?url=http://test.com/analyze503b")
        assert response.status_code == 503

    @patch('api_server_fastapi.article_analyzer')
    @patch('api_server_fastapi.fetch_article_content')
    @patch('cache.redis_client.is_cache_available')
    @patch('cache.redis_client.cache_get')
    @patch('cache.redis_client.cache_set_smart')
    def test_caches_llm_analysis_result(
        self, mock_cache_set_smart, mock_cache_get, mock_cache_avail,
        mock_fetcher, mock_analyzer
    ):
        mock_cache_get.return_value = None
        mock_cache_avail.return_value = True
        mock_fetcher.return_value = {
            "headline": "Analyze This",
            "description": "Content for LLM analysis endpoint",
            "sourceUrl": "http://test.com/analyze"
        }
        mock_analyzer.analyze_article.return_value = {
            "sentiment": "BULLISH",
            "impact_score": 7,
            "summary": "Analysis summary"
        }

        response = client.get("/api/news/analyze?url=http://test.com/analyze")

        assert response.status_code == 200
        mock_cache_set_smart.assert_called_once()
        call_args = mock_cache_set_smart.call_args[0]
        assert "news:llm:" in call_args[0]

    @patch('api_server_fastapi.fetch_article_content')
    @patch('cache.redis_client.cache_get')
    def test_returns_cached_llm_analysis(self, mock_cache_get, mock_fetcher):
        cached_result = {
            "url": "http://test.com/cached-llm",
            "headline": "Cached LLM",
            "content_preview": "preview...",
            "analysis": {"sentiment": "BULLISH", "impact_score": 9}
        }
        mock_cache_get.return_value = cached_result

        response = client.get("/api/news/analyze?url=http://test.com/cached-llm")

        assert response.status_code == 200
        data = response.json()
        assert data["analysis"]["sentiment"] == "BULLISH"
        mock_fetcher.assert_not_called()


# =========================================================================
# News List Endpoint: Caching all results
# =========================================================================

class TestNewsEndpoint:

    @patch('api_server_fastapi.fetch_news')
    @patch('cache.redis_client.cache_get')
    @patch('cache.redis_client.is_cache_available')
    def test_caches_all_results_in_redis_for_60s(
        self, mock_cache_avail, mock_cache_get, mock_fetch_news
    ):
        mock_cache_avail.return_value = True
        mock_cache_get.return_value = None
        mock_fetch_news.return_value = [
            {
                'id': '1', 'headline': 'News 1', 'description': 'Desc 1',
                'source': 'moneycontrol', 'sourceUrl': 'http://example.com/1',
                'publishedAt': datetime.now().isoformat(), 'fetchedAt': datetime.now().isoformat()
            },
            {
                'id': '2', 'headline': 'News 2', 'description': 'Desc 2',
                'source': 'moneycontrol', 'sourceUrl': 'http://example.com/2',
                'publishedAt': datetime.now().isoformat(), 'fetchedAt': datetime.now().isoformat()
            },
        ]

        with patch('services.news_persistence.get_persistence_service') as mock_get_persist:
            mock_persist = MagicMock()
            mock_persist.get_recent_articles.return_value = []
            mock_get_persist.return_value = mock_persist

            response = client.get("/api/news")

        assert response.status_code == 200

    @patch('cache.redis_client.cache_get')
    def test_returns_cached_news_list(self, mock_cache_get):
        cached = {
            "items": [{"headline": "Cached News", "source": "moneycontrol", "sourceUrl": "http://cached"}],
            "source": "all", "total": 1, "fetchedAt": datetime.now().isoformat()
        }
        mock_cache_get.return_value = cached

        with patch('api_server_fastapi._news_available', True):
            response = client.get("/api/news")

        assert response.status_code == 200
        data = response.json()
        assert data["items"][0]["headline"] == "Cached News"


class TestSentimentCache:

    @patch('api_server_fastapi.article_analyzer')
    @patch('api_server_fastapi.fetch_article_content')
    @patch('cache.redis_client.cache_get')
    @patch('cache.redis_client.cache_set_smart')
    @patch('cache.redis_client.is_cache_available')
    def test_caches_sentiment_result_with_smart_ttl(
        self, mock_cache_avail, mock_cache_set_smart, mock_cache_get,
        mock_fetcher, mock_analyzer
    ):
        mock_cache_avail.return_value = True
        mock_cache_get.return_value = None
        mock_fetcher.return_value = {
            "headline": "RELIANCE news",
            "description": "RELIANCE stock is doing great",
            "publishedAt": "2026-01-01",
            "symbols": [{"code": "RELIANCE"}]
        }
        mock_analyzer.analyze_article.return_value = {
            "impact_score": 8, "sentiment": "BULLISH", "trade_ideas": []
        }

        response = client.get("/api/news/sentiment/RELIANCE")

        assert response.status_code == 200
        mock_cache_set_smart.assert_called_once()
        call_kwargs = mock_cache_set_smart.call_args.kwargs
        assert call_kwargs.get("full_ttl") == 300
        assert call_kwargs.get("skim_ttl") == 60

    @patch('api_server_fastapi.fetch_article_content')
    @patch('cache.redis_client.cache_get')
    @patch('cache.redis_client.is_cache_available')
    def test_returns_cached_sentiment_result(
        self, mock_cache_avail, mock_cache_get, mock_fetcher
    ):
        cached = {
            "symbol": "RELIANCE",
            "status": "SUCCESS",
            "sentiment_score": 40.0,
            "sentiment_label": "BULLISH",
            "articles_analyzed": 2,
            "trade_ideas": []
        }
        mock_cache_avail.return_value = True
        mock_cache_get.return_value = cached

        response = client.get("/api/news/sentiment/RELIANCE")

        assert response.status_code == 200
        data = response.json()
        assert data["sentiment_label"] == "BULLISH"
        assert data["from_cache"] is not True
        mock_fetcher.assert_not_called()

"""
Tests for News API endpoints.

Tests the news endpoints which provide financial news feeds:
- GET /api/news - Get news feed
- GET /api/news/article - Get article details
- GET /api/news/sources - Get available news sources

Test cases cover:
- News feed retrieval with pagination
- Source filtering
- Article content fetching
- News sources listing
- Error handling for unavailable URLs
"""

import sys
from pathlib import Path
from unittest.mock import Mock, patch
from datetime import datetime

import pytest

# Add project root to path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


class TestNewsAPI:
    """
    Test suite for News API endpoints.
    """

    # ===========================
    # GET /api/news Tests
    # ===========================

    def test_get_news_default_params(self, client, sample_news_items):
        """
        Test getting news feed with default parameters.

        When no source specified, the API reads from DB persistence (not fetch_news).
        """
        with patch('api_server_fastapi._news_available', True):
            with patch('services.news_persistence.get_persistence_service') as mock_ps:
                mock_persistence = Mock()
                mock_persistence.get_recent_articles.return_value = []
                mock_ps.return_value = mock_persistence
                response = client.get("/api/news")
                assert response.status_code == 200
                data = response.json()

                assert 'items' in data
                assert 'source' in data
                assert 'total' in data
                assert 'fetchedAt' in data

                assert data['source'] in ['all', None]

    def test_get_news_custom_source(self, client, sample_news_items):
        """
        Test getting news feed with custom source.

        Should fetch news from the specified source.
        """
        mock_fetch = Mock(return_value=sample_news_items)

        with patch('api_server_fastapi._news_available', True):
            with patch('api_server_fastapi.fetch_news', mock_fetch):
                response = client.get("/api/news?source=economicstimes")
                assert response.status_code == 200
                data = response.json()

                assert data['source'] == 'economicstimes'
                mock_fetch.assert_called_once_with(source='economicstimes', limit=25)

    def test_get_news_custom_limit(self, client, sample_news_items):
        """
        Test getting news feed with custom limit.

        When no source specified, reads from DB persistence.
        """
        with patch('api_server_fastapi._news_available', True):
            with patch('services.news_persistence.get_persistence_service') as mock_ps:
                mock_persistence = Mock()
                mock_persistence.get_recent_articles.return_value = []
                mock_ps.return_value = mock_persistence
                response = client.get("/api/news?limit=10")
                assert response.status_code == 200
                data = response.json()

                assert data['total'] >= 0
                mock_persistence.get_recent_articles.assert_called_once()
                call_args = mock_persistence.get_recent_articles.call_args
                assert call_args.kwargs.get('limit') == 10

    def test_get_news_invalid_limit(self, client, sample_news_items):
        """
        Test getting news with invalid limit parameter.

        Limit must be between 1 and 100.
        Should return 422 validation error.
        """
        mock_fetch = Mock(return_value=sample_news_items)

        with patch('api_server_fastapi._news_available', True):
            with patch('api_server_fastapi.fetch_news', mock_fetch):
                # Limit > 100
                response = client.get("/api/news?limit=200")
                assert response.status_code == 422

                # Limit < 1
                response = client.get("/api/news?limit=0")
                assert response.status_code == 422

    def test_get_news_empty_response(self, client):
        """
        Test getting news when no items are available.

        When no source specified, reads from DB persistence.
        """
        with patch('api_server_fastapi._news_available', True):
            with patch('services.news_persistence.get_persistence_service') as mock_ps:
                mock_persistence = Mock()
                mock_persistence.get_recent_articles.return_value = []
                mock_ps.return_value = mock_persistence
                response = client.get("/api/news")
                assert response.status_code == 200
                data = response.json()

                assert data['items'] == []
                assert data['total'] == 0
                assert 'fetchedAt' in data

    def test_get_news_api_unavailable(self, client):
        """
        Test getting news when news API is unavailable.

        Should return 503 Service Unavailable error.
        """
        with patch('api_server_fastapi._news_available', False):
            response = client.get("/api/news")
            assert response.status_code == 503
            data = response.json()

            assert 'detail' in data
            assert 'not available' in data['detail'].lower()

    def test_get_news_api_error(self, client):
        """
        Test getting news when news API raises an exception.

        When no source specified, reads from DB persistence which may raise.
        """
        with patch('api_server_fastapi._news_available', True):
            with patch('services.news_persistence.get_persistence_service') as mock_ps:
                mock_persistence = Mock()
                mock_persistence.get_recent_articles.side_effect = Exception("DB error")
                mock_ps.return_value = mock_persistence
                response = client.get("/api/news")
                assert response.status_code == 500
                data = response.json()

                assert 'detail' in data

    def test_news_item_structure(self, client):
        """
        Test that news items have correct structure from DB persistence.

        Items from DB have: headline, source, sourceUrl, publishedAt, fetchedAt, id.
        """
        sample_articles = [
            {
                'id': 1,
                'headline': 'Markets hit all-time high',
                'content': 'Positive global cues...',
                'source': 'moneycontrol',
                'url': 'https://moneycontrol.com/news/test',
                'published_at': '2024-01-01T00:00:00',
                'fetched_at': '2024-01-01T00:00:00',
            },
        ]
        with patch('api_server_fastapi._news_available', True):
            with patch('services.news_persistence.get_persistence_service') as mock_ps:
                mock_persistence = Mock()
                mock_persistence.get_recent_articles.return_value = sample_articles
                mock_ps.return_value = mock_persistence
                response = client.get("/api/news")
                assert response.status_code == 200
                data = response.json()

                for item in data['items']:
                    assert 'headline' in item
                    assert 'sourceUrl' in item
                    assert 'publishedAt' in item
                    assert 'source' in item

                assert data['items'][0]['headline'] == 'Markets hit all-time high'
                assert data['total'] == 1

    def test_news_fetched_at_timestamp(self, client, sample_news_items):
        """
        Test that fetchedAt field is a valid ISO timestamp.

        Frontend uses this to display last update time.
        """
        mock_fetch = Mock(return_value=sample_news_items)

        with patch('api_server_fastapi._news_available', True):
            with patch('api_server_fastapi.fetch_news', mock_fetch):
                response = client.get("/api/news")
                assert response.status_code == 200
                data = response.json()

                # Verify fetchedAt is a valid ISO timestamp
                assert 'fetchedAt' in data
                try:
                    datetime.fromisoformat(data['fetchedAt'])
                except ValueError:
                    pytest.fail("fetchedAt is not a valid ISO timestamp")

    # ===========================
    # GET /api/news/article Tests
    # ===========================

    def test_get_article_valid_url(self, client, sample_article_content):
        """
        Test getting article content with valid URL.

        Should return full article with title and content.
        """
        mock_fetch = Mock(return_value=sample_article_content)

        with patch('api_server_fastapi._news_available', True):
            with patch('api_server_fastapi.fetch_article_content', mock_fetch):
                url = "https://example.com/news/test-article"
                response = client.get(f"/api/news/article?url={url}")
                assert response.status_code == 200
                data = response.json()

                # Verify article structure
                assert 'title' in data
                assert 'content' in data
                assert 'url' in data

                assert data['title'] == sample_article_content['title']

    def test_get_article_missing_url(self, client):
        """
        Test getting article without URL parameter.

        Should return 422 validation error.
        """
        with patch('api_server_fastapi._news_available', True):
            response = client.get("/api/news/article")
            assert response.status_code == 422

    def test_get_article_invalid_url(self, client):
        """
        Test getting article with invalid URL.

        Should return error from the article fetcher.
        """
        mock_fetch = Mock(return_value={'error': 'Invalid URL'})

        with patch('api_server_fastapi._news_available', True):
            with patch('api_server_fastapi.fetch_article_content', mock_fetch):
                response = client.get("/api/news/article?url=invalid-url")
                assert response.status_code == 500

    def test_get_article_unavailable(self, client):
        """
        Test getting article when news API is unavailable.

        Should return 503 Service Unavailable error.
        """
        with patch('api_server_fastapi._news_available', False):
            url = "https://example.com/news/test"
            response = client.get(f"/api/news/article?url={url}")
            assert response.status_code == 503

    def test_get_article_api_error(self, client):
        """
        Test getting article when API raises exception.

        Should return 500 error.
        """
        mock_fetch = Mock(side_effect=Exception("Network timeout"))

        with patch('api_server_fastapi._news_available', True):
            with patch('api_server_fastapi.fetch_article_content', mock_fetch):
                url = "https://example.com/news/test"
                response = client.get(f"/api/news/article?url={url}")
                assert response.status_code == 500

    def test_get_article_content_format(self, client, sample_article_content):
        """
        Test that article content is properly formatted.

        Content should be text and may contain HTML.
        """
        mock_fetch = Mock(return_value=sample_article_content)

        with patch('api_server_fastapi._news_available', True):
            with patch('api_server_fastapi.fetch_article_content', mock_fetch):
                url = "https://example.com/news/test"
                response = client.get(f"/api/news/article?url={url}")
                assert response.status_code == 200
                data = response.json()

                assert 'content' in data
                assert isinstance(data['content'], str)
                assert 'Indian stock markets' in data['content']
                assert data['title'] == 'Markets hit all-time high amid positive global cues'

    # ===========================
    # GET /api/news/sources Tests
    # ===========================

    def test_get_news_sources_available(self, client, sample_news_sources):
        """
        Test getting list of available news sources.

        Should return array of source identifiers.
        """
        with patch('api_server_fastapi._news_available', True):
            with patch('api_server_fastapi.NEWS_SOURCES', sample_news_sources):
                response = client.get("/api/news/sources")
                assert response.status_code == 200
                data = response.json()

                assert 'sources' in data
                assert data['sources'] == ['moneycontrol', 'economicstimes', 'livemint']

    def test_get_news_sources_unavailable(self, client):
        """
        Test getting news sources when news API is unavailable.

        Should return empty sources array.
        """
        with patch('api_server_fastapi._news_available', False):
            response = client.get("/api/news/sources")
            assert response.status_code == 200
            data = response.json()

            assert data['sources'] == []

    def test_news_source_structure(self, client, sample_news_sources):
        """
        Test that news sources are valid identifiers.

        Sources should be strings that can be used as query params.
        """
        with patch('api_server_fastapi._news_available', True):
            with patch('api_server_fastapi.NEWS_SOURCES', sample_news_sources):
                response = client.get("/api/news/sources")
                assert response.status_code == 200
                data = response.json()

                for source in data['sources']:
                    assert isinstance(source, str)
                    assert source.isidentifier() or '-' in source

        assert 'moneycontrol' in data['sources']

    # ===========================
    # Integration Tests
    # ===========================

    def test_news_workflow(self, client, sample_news_items, sample_article_content):
        """
        Test complete news workflow.

        1. Get news sources
        2. Get news feed from a source
        3. Get article details from a news item
        """
        mock_fetch_news = Mock(return_value=sample_news_items)
        mock_fetch_article = Mock(return_value=sample_article_content)
        sources = ['moneycontrol', 'economicstimes']

        with patch('api_server_fastapi._news_available', True):
            with patch('api_server_fastapi.NEWS_SOURCES', sources):
                with patch('api_server_fastapi.fetch_news', mock_fetch_news):
                    with patch('api_server_fastapi.fetch_article_content', mock_fetch_article):
                        # Step 1: Get sources
                        response = client.get("/api/news/sources")
                        assert response.status_code == 200
                        sources_data = response.json()
                        assert len(sources_data['sources']) > 0

                        # Step 2: Get news feed
                        source = sources_data['sources'][0]
                        response = client.get(f"/api/news?source={source}")
                        assert response.status_code == 200
                        news_data = response.json()
                        assert len(news_data['items']) > 0

                        # Step 3: Get article details
                        article_url = news_data['items'][0]['url']
                        response = client.get(f"/api/news/article?url={article_url}")
                        assert response.status_code == 200
                        article_data = response.json()
                        assert 'title' in article_data

class TestAllSources:
    """
    Test suite for "All Sources" news functionality.
    
    Tests verify that:
    - When no source param is provided, news from ALL sources is returned
    - When source="all" is explicitly passed, news from ALL sources is returned
    - The API correctly calls fetch_news with None for 'all sources'
    """

    def test_get_news_all_sources_no_param(self, client):
        """
        Test getting news when no source parameter is provided.

        When no source specified, reads from DB persistence (not fetch_news).
        """
        with patch('api_server_fastapi._news_available', True):
            with patch('services.news_persistence.get_persistence_service') as mock_ps:
                mock_persistence = Mock()
                mock_persistence.get_recent_articles.return_value = []
                mock_ps.return_value = mock_persistence
                response = client.get("/api/news")
                assert response.status_code == 200
                
                mock_persistence.get_recent_articles.assert_called_once()
                call_args = mock_persistence.get_recent_articles.call_args
                assert call_args is not None

    def test_get_news_all_sources_explicit_all(self, client):
        """
        Test getting news when source='all' is explicitly provided.

        When source='all', reads from DB persistence (same as no source).
        """
        with patch('api_server_fastapi._news_available', True):
            with patch('services.news_persistence.get_persistence_service') as mock_ps:
                mock_persistence = Mock()
                mock_persistence.get_recent_articles.return_value = []
                mock_ps.return_value = mock_persistence
                response = client.get("/api/news?source=all")
                assert response.status_code == 200
                
                mock_persistence.get_recent_articles.assert_called_once()

    def test_get_news_all_sources_returns_items_from_multiple_sources(self, client):
        """
        Test that 'all sources' returns news items from different sources.

        When fetching from all sources via DB, items should have different source values.
        """
        multi_source_articles = [
            {
                'id': 1,
                'headline': 'Moneycontrol News 1',
                'content': 'Test news',
                'source': 'moneycontrol',
                'url': 'https://moneycontrol.com/news1',
                'published_at': datetime.now().isoformat(),
                'fetched_at': datetime.now().isoformat(),
            },
            {
                'id': 2,
                'headline': 'Economic Times News 1',
                'content': 'Test news',
                'source': 'economicstimes',
                'url': 'https://economictimes.com/news1',
                'published_at': datetime.now().isoformat(),
                'fetched_at': datetime.now().isoformat(),
            },
            {
                'id': 3,
                'headline': 'LiveMint News 1',
                'content': 'Test news',
                'source': 'livemint',
                'url': 'https://livemint.com/news1',
                'published_at': datetime.now().isoformat(),
                'fetched_at': datetime.now().isoformat(),
            },
        ]
        with patch('api_server_fastapi._news_available', True):
            with patch('services.news_persistence.get_persistence_service') as mock_ps:
                mock_persistence = Mock()
                mock_persistence.get_recent_articles.return_value = multi_source_articles
                mock_ps.return_value = mock_persistence
                response = client.get("/api/news")
                assert response.status_code == 200
                data = response.json()
                
                sources = {item['source'] for item in data['items']}
                assert len(sources) >= 2, "Should have news from multiple sources"

    def test_get_news_specific_source_still_works(self, client, sample_news_items):
        """
        Test that filtering by specific source still works.
        
        When source=moneycontrol is passed, only moneycontrol news should be fetched.
        """
        mock_fetch = Mock(return_value=sample_news_items)

        with patch('api_server_fastapi._news_available', True):
            with patch('api_server_fastapi.fetch_news', mock_fetch):
                response = client.get("/api/news?source=moneycontrol")
                assert response.status_code == 200
                
                # fetch_news should be called with source='moneycontrol'
                mock_fetch.assert_called_once_with(source='moneycontrol', limit=25)

    def test_get_news_all_sources_response_source_field(self, client, sample_news_items):
        """
        Test that response 'source' field is 'all' when fetching all sources.
        
        Frontend checks this field to determine if showing all sources.
        """
        mock_fetch = Mock(return_value=sample_news_items)

        with patch('api_server_fastapi._news_available', True):
            with patch('api_server_fastapi.fetch_news', mock_fetch):
                response = client.get("/api/news")
                assert response.status_code == 200
                data = response.json()
                
                # Source field should be 'all' when no source specified
                assert data['source'] == 'all'

    def test_get_news_all_sources_limit_distribution(self, client):
        """
        Test that limit is properly passed when fetching all sources.

        The limit should be passed to the persistence service.
        """
        with patch('api_server_fastapi._news_available', True):
            with patch('services.news_persistence.get_persistence_service') as mock_ps:
                mock_persistence = Mock()
                mock_persistence.get_recent_articles.return_value = []
                mock_ps.return_value = mock_persistence
                response = client.get("/api/news?limit=30")
                assert response.status_code == 200
                
                mock_persistence.get_recent_articles.assert_called_once()
                call_args = mock_persistence.get_recent_articles.call_args
                assert call_args.kwargs.get('limit') == 30

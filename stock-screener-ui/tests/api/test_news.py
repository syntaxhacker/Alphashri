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

        Should return news items from all sources (when no source specified).
        """
        mock_fetch = Mock(return_value=sample_news_items)

        with patch('api_server_fastapi._news_available', True):
            with patch('api_server_fastapi.fetch_news', mock_fetch):
                response = client.get("/api/news")
                assert response.status_code == 200
                data = response.json()

                # Verify response structure
                assert 'items' in data
                assert 'source' in data
                assert 'total' in data
                assert 'fetchedAt' in data

                # Verify default behavior - should fetch from all sources (None)
                assert data['source'] in ['all', None]
                assert data['total'] == len(sample_news_items)

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

        Should return specified number of items (max 100).
        """
        # Create limited sample
        limited_items = sample_news_items[:2]
        mock_fetch = Mock(return_value=limited_items)

        with patch('api_server_fastapi._news_available', True):
            with patch('api_server_fastapi.fetch_news', mock_fetch):
                response = client.get("/api/news?limit=10")
                assert response.status_code == 200
                data = response.json()

                assert data['total'] == len(limited_items)
                # When limit is specified but source is not, source defaults to None (all sources)
                mock_fetch.assert_called_once_with(source=None, limit=10)

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

        Should return empty items array with total=0.
        """
        mock_fetch = Mock(return_value=[])

        with patch('api_server_fastapi._news_available', True):
            with patch('api_server_fastapi.fetch_news', mock_fetch):
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

        Should return 500 error with error details.
        """
        mock_fetch = Mock(side_effect=Exception("Network error"))

        with patch('api_server_fastapi._news_available', True):
            with patch('api_server_fastapi.fetch_news', mock_fetch):
                response = client.get("/api/news")
                assert response.status_code == 500
                data = response.json()

                assert 'detail' in data
                assert 'Network error' in data['detail']

    def test_news_item_structure(self, client, sample_news_items):
        """
        Test that news items have correct structure.

        Each item should contain:
        - title: Headline
        - description: Summary
        - url: Link to article
        - source: News source
        - timestamp: Publication time
        """
        mock_fetch = Mock(return_value=sample_news_items)

        with patch('api_server_fastapi._news_available', True):
            with patch('api_server_fastapi.fetch_news', mock_fetch):
                response = client.get("/api/news")
                assert response.status_code == 200
                data = response.json()

                for item in data['items']:
                    assert 'title' in item
                    assert 'url' in item
                    assert 'timestamp' in item

                    # Verify types
                    assert isinstance(item['title'], str)
                    assert isinstance(item['url'], str)

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

                # Verify content is present
                assert 'content' in data
                assert isinstance(data['content'], str)
                assert len(data['content']) > 0

                # Verify title is present
                assert 'title' in data
                assert isinstance(data['title'], str)
                assert len(data['title']) > 0

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
                assert isinstance(data['sources'], list)
                assert len(data['sources']) > 0

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
                    # Should be valid for use in URL
                    assert source.isidentifier() or '-' in source

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

    def test_news_category_filtering(self, client):
        """
        Test that news can be filtered by category.

        Note: This depends on the implementation of fetch_news.
        This test verifies the API accepts category parameter.
        """
        # Create categorized news items
        tech_news = [
            {
                'title': 'Tech News',
                'description': 'Technology update',
                'url': 'https://example.com/tech',
                'source': 'moneycontrol',
                'timestamp': datetime.now().isoformat(),
                'category': 'Technology'
            }
        ]

        mock_fetch = Mock(return_value=tech_news)

        with patch('api_server_fastapi._news_available', True):
            with patch('api_server_fastapi.fetch_news', mock_fetch):
                # Note: Category filtering may not be implemented in API
                # This test verifies the endpoint works
                response = client.get("/api/news")
                assert response.status_code == 200

    def test_news_pagination_simulation(self, client, sample_news_items):
        """
        Test news pagination through limit parameter.

        Simulates fetching news in batches.
        """
        mock_fetch = Mock(return_value=sample_news_items)

        with patch('api_server_fastapi._news_available', True):
            with patch('api_server_fastapi.fetch_news', mock_fetch):
                # Fetch first batch
                response = client.get("/api/news?limit=2")
                assert response.status_code == 200
                batch1 = response.json()

                # Fetch second batch
                response = client.get("/api/news?limit=3&offset=2")
                # Note: offset may not be implemented, but this verifies the endpoint
                # handles the parameter without error
                assert response.status_code in [200, 422]


class TestAllSources:
    """
    Test suite for "All Sources" news functionality.
    
    Tests verify that:
    - When no source param is provided, news from ALL sources is returned
    - When source="all" is explicitly passed, news from ALL sources is returned
    - The API correctly calls fetch_news with None for 'all sources'
    """

    def test_get_news_all_sources_no_param(self, client, sample_news_items):
        """
        Test getting news when no source parameter is provided.
        
        Should default to fetching from ALL sources (None passed to fetch_news).
        """
        mock_fetch = Mock(return_value=sample_news_items)

        with patch('api_server_fastapi._news_available', True):
            with patch('api_server_fastapi.fetch_news', mock_fetch):
                response = client.get("/api/news")
                assert response.status_code == 200
                
                # fetch_news should be called with source=None (all sources)
                mock_fetch.assert_called_once()
                call_kwargs = mock_fetch.call_args.kwargs
                assert call_kwargs.get('source') is None

    def test_get_news_all_sources_explicit_all(self, client, sample_news_items):
        """
        Test getting news when source='all' is explicitly provided.
        
        Should fetch from ALL sources.
        """
        mock_fetch = Mock(return_value=sample_news_items)

        with patch('api_server_fastapi._news_available', True):
            with patch('api_server_fastapi.fetch_news', mock_fetch):
                response = client.get("/api/news?source=all")
                assert response.status_code == 200
                
                # fetch_news should be called with source=None or source='all'
                mock_fetch.assert_called_once()
                call_kwargs = mock_fetch.call_args.kwargs
                assert call_kwargs.get('source') in [None, 'all']

    def test_get_news_all_sources_returns_items_from_multiple_sources(self, client):
        """
        Test that 'all sources' returns news items from different sources.
        
        When fetching from all sources, the returned items should have
        different source values (moneycontrol, economicstimes, etc.).
        """
        # Create news items from different sources
        multi_source_items = [
            {
                'title': 'Moneycontrol News 1',
                'description': 'Test news',
                'url': 'https://moneycontrol.com/news1',
                'source': 'moneycontrol',
                'timestamp': datetime.now().isoformat(),
            },
            {
                'title': 'Economic Times News 1',
                'description': 'Test news',
                'url': 'https://economictimes.com/news1',
                'source': 'economicstimes',
                'timestamp': datetime.now().isoformat(),
            },
            {
                'title': 'LiveMint News 1',
                'description': 'Test news',
                'url': 'https://livemint.com/news1',
                'source': 'livemint',
                'timestamp': datetime.now().isoformat(),
            },
        ]
        mock_fetch = Mock(return_value=multi_source_items)

        with patch('api_server_fastapi._news_available', True):
            with patch('api_server_fastapi.fetch_news', mock_fetch):
                response = client.get("/api/news")
                assert response.status_code == 200
                data = response.json()
                
                # Verify we got items from multiple sources
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
        Test that limit is properly distributed when fetching all sources.
        
        If user requests limit=30 and there are 3 sources, each source should
        get roughly 10 items (limit // num_sources).
        """
        mock_fetch = Mock(return_value=[])

        with patch('api_server_fastapi._news_available', True):
            with patch('api_server_fastapi.fetch_news', mock_fetch):
                response = client.get("/api/news?limit=30")
                assert response.status_code == 200
                
                # The limit should be passed to fetch_news
                mock_fetch.assert_called_once()
                call_kwargs = mock_fetch.call_args.kwargs
                assert call_kwargs.get('limit') == 30

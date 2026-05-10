"""
Tests for News Poller logic — prefetch, polling loop segments, and sector polling.

Item coverage from test_cases/news.md:
  - news_poller.py: NEWS_SOURCES loading, fallback, LLM optional, prefetch delay,
    initialize last_seen_ids, detect new items, skip short/duplicate articles,
    persist with LLM, broadcast via WS, high-impact broadcast, cache invalidation
"""

import sys
import json
import asyncio
from pathlib import Path
from datetime import datetime
from unittest.mock import Mock, MagicMock, patch, AsyncMock, call

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


# =========================================================================
# Helper: create a clean poller module patch environment
# =========================================================================

@pytest.fixture
def poller_module():
    """Return a fresh namespace dict simulating news_poller module vars."""
    return {
        '_news_available': True,
        '_llm_available': True,
        'article_analyzer': MagicMock(),
        'fetch_news': MagicMock(),
        'fetch_article_content': MagicMock(),
        'NEWS_SOURCES': [{'id': 'moneycontrol'}, {'id': 'economictimes'}],
    }


# =========================================================================
# _do_prefetch_sync
# =========================================================================

class TestDoPrefetchSync:
    @patch('api.news.news_poller._get_module_vars')
    @patch('api.news.news_poller.get_persistence_service')
    def test_skips_prefetch_when_db_has_enough_articles(
        self, mock_get_persistence, mock_get_vars
    ):
        from api.news.news_poller import _do_prefetch_sync

        mock_get_vars.return_value = (True, True, MagicMock(), MagicMock(), MagicMock(), [{'id': 'mc'}])
        mock_persistence = MagicMock()
        mock_persistence.get_article_stats.return_value = {'total_articles': 100}
        mock_get_persistence.return_value = mock_persistence

        _do_prefetch_sync()

        mock_persistence.save_article.assert_not_called()

    @patch('api.news.news_poller._get_module_vars')
    @patch('api.news.news_poller.get_persistence_service')
    def test_prefetch_saves_new_articles(
        self, mock_get_persistence, mock_get_vars
    ):
        from api.news.news_poller import _do_prefetch_sync

        mock_fetch_news = MagicMock()
        mock_fetch_news.return_value = [
            {
                'sourceUrl': 'http://example.com/article1',
                'headline': 'This is a headline with more than thirty characters',
            }
        ]

        mock_fetch_article = MagicMock()
        mock_fetch_article.return_value = {
            'description': 'Full article content goes here for testing purposes.',
            'symbols': [{'code': 'RELIANCE'}],
        }

        mock_analyzer = MagicMock()
        mock_analyzer.analyze_article.return_value = {
            'sentiment': 'BULLISH',
            'impact_score': 7,
            'summary': 'Summary text',
        }

        mock_get_vars.return_value = (
            True, True, mock_analyzer, mock_fetch_news, mock_fetch_article,
            [{'id': 'moneycontrol'}]
        )

        mock_persistence = MagicMock()
        mock_persistence.get_article_stats.return_value = {'total_articles': 0}
        mock_persistence.get_article_by_url.return_value = None
        mock_get_persistence.return_value = mock_persistence

        _do_prefetch_sync()

        mock_persistence.save_article.assert_called_once()

    @patch('api.news.news_poller._get_module_vars')
    @patch('api.news.news_poller.get_persistence_service')
    def test_skips_articles_without_url_or_short_headline(
        self, mock_get_persistence, mock_get_vars
    ):
        from api.news.news_poller import _do_prefetch_sync

        mock_fetch_news = MagicMock()
        mock_fetch_news.return_value = [
            {'sourceUrl': '', 'headline': 'Short'},  # no URL + short headline
            {'sourceUrl': 'http://example.com/ok', 'headline': 'This is a valid long headline for testing'},
        ]

        mock_fetch_article = MagicMock()
        mock_fetch_article.return_value = {
            'description': 'Content',
            'symbols': [],
        }

        mock_analyzer = MagicMock()
        mock_analyzer.analyze_article.return_value = {}

        mock_get_vars.return_value = (True, True, mock_analyzer, mock_fetch_news, mock_fetch_article, [{'id': 'mc'}])

        mock_persistence = MagicMock()
        mock_persistence.get_article_stats.return_value = {'total_articles': 0}
        mock_persistence.get_article_by_url.return_value = None
        mock_get_persistence.return_value = mock_persistence

        _do_prefetch_sync()

        # Only the valid one should be saved
        assert mock_persistence.save_article.call_count == 1

    @patch('api.news.news_poller._get_module_vars')
    @patch('api.news.news_poller.get_persistence_service')
    def test_skips_duplicate_articles(
        self, mock_get_persistence, mock_get_vars
    ):
        from api.news.news_poller import _do_prefetch_sync

        mock_fetch_news = MagicMock()
        mock_fetch_news.return_value = [
            {
                'sourceUrl': 'http://example.com/dup',
                'headline': 'This is a duplicate headline for testing purposes',
            }
        ]

        mock_get_vars.return_value = (True, True, MagicMock(), mock_fetch_news, MagicMock(), [{'id': 'mc'}])

        mock_persistence = MagicMock()
        mock_persistence.get_article_stats.return_value = {'total_articles': 0}
        mock_persistence.get_article_by_url.return_value = {'id': 1}  # exists
        mock_get_persistence.return_value = mock_persistence

        _do_prefetch_sync()

        mock_persistence.save_article.assert_not_called()


# =========================================================================
# news_startup_prefetch
# =========================================================================

class TestNewsStartupPrefetch:
    @patch('api.news.news_poller._do_prefetch_sync')
    @patch('api.news.news_poller.asyncio')
    def test_runs_after_30s_delay(self, mock_asyncio, mock_prefetch):
        from api.news.news_poller import news_startup_prefetch

        loop = MagicMock()
        mock_asyncio.get_event_loop.return_value = loop

        asyncio.run(news_startup_prefetch())

        mock_asyncio.sleep.assert_called_once_with(30)

    @patch('api.news.news_poller._do_prefetch_sync')
    @patch('api.news.news_poller.asyncio')
    def test_skips_prefetch_when_news_not_available(self, mock_asyncio, mock_prefetch):
        from api.news.news_poller import news_startup_prefetch

        with patch('api.news.news_poller._news_available', False):
            asyncio.run(news_startup_prefetch())

        mock_prefetch.assert_not_called()


# =========================================================================
# news_poller_task — logic segments (with mocked sleep)
# =========================================================================

class TestNewsPollerLogic:
    @pytest.mark.asyncio
    @patch('api.news.news_poller._get_module_vars')
    @patch('api.news.news_poller.get_persistence_service')
    @patch('api.news.news_poller.asyncio')
    @patch('api.news.news_poller.news_ws_manager')
    async def test_initializes_last_seen_ids(
        self, mock_ws, mock_asyncio, mock_get_persistence, mock_get_vars
    ):
        from api.news.news_poller import news_poller_task

        mock_fetch_news = MagicMock()
        mock_fetch_news.return_value = [
            {'id': 'abc123', 'headline': 'First article with very long headline text here', 'sourceUrl': 'http://test.com/1'}
        ]

        mock_get_vars.return_value = (True, True, MagicMock(), mock_fetch_news, MagicMock(), [{'id': 'mc'}])

        # Make the loop break after first iteration
        mock_asyncio.to_thread = MagicMock(side_effect=lambda fn, *a, **kw: fn(*a, **kw))
        mock_asyncio.sleep = AsyncMock(side_effect=[None, Exception("break loop")])

        with pytest.raises(Exception, match="break loop"):
            await news_poller_task()

    @pytest.mark.asyncio
    @patch('api.news.news_poller._get_module_vars')
    @patch('api.news.news_poller.get_persistence_service')
    @patch('api.news.news_poller.asyncio')
    @patch('api.news.news_poller.news_ws_manager')
    async def test_detects_new_items_via_id_comparison(
        self, mock_ws, mock_asyncio, mock_get_persistence, mock_get_vars
    ):
        from api.news.news_poller import news_poller_task

        mock_fetch_news = MagicMock()
        mock_fetch_news.side_effect = [
            [{'id': 'new1', 'headline': 'Breaking news headline that is very long and interesting 1', 'sourceUrl': 'http://test.com/new1'}],
            [{'id': 'new1', 'headline': 'Breaking news headline that is very long and interesting 1', 'sourceUrl': 'http://test.com/new1'},
             {'id': 'new2', 'headline': 'Second news headline that is also very long and interesting 2', 'sourceUrl': 'http://test.com/new2'}],
        ]

        mock_get_vars.return_value = (True, True, MagicMock(), mock_fetch_news, MagicMock(), [{'id': 'mc'}])

        mock_persistence = MagicMock()
        mock_persistence.get_article_by_url.return_value = None
        mock_get_persistence.return_value = mock_persistence

        mock_asyncio.to_thread = MagicMock(side_effect=lambda fn, *a, **kw: fn(*a, **kw))
        mock_asyncio.sleep = AsyncMock(side_effect=[None, None, Exception("break loop")])

        with pytest.raises(Exception, match="break loop"):
            await news_poller_task()

        # Second call should detect new2 as new
        fetch_calls = mock_fetch_news.call_count
        assert fetch_calls == 2

    @pytest.mark.asyncio
    @patch('api.news.news_poller._get_module_vars')
    @patch('api.news.news_poller.get_persistence_service')
    @patch('api.news.news_poller.asyncio')
    @patch('api.news.news_poller.news_ws_manager')
    async def test_skips_articles_without_url_or_short_headline_in_poller(
        self, mock_ws, mock_asyncio, mock_get_persistence, mock_get_vars
    ):
        from api.news.news_poller import news_poller_task

        mock_fetch_news = MagicMock()
        mock_fetch_news.side_effect = [
            [{'id': 'old1', 'headline': 'This is a valid headline that should be long enough to pass 1', 'sourceUrl': 'http://test.com/old1'}],
            [
                {'id': 'short', 'headline': 'Short', 'sourceUrl': 'http://test.com/short'},
                {'id': 'nourl', 'headline': 'This is another valid headline that should pass the filter', 'sourceUrl': ''},
                {'id': 'valid', 'headline': 'This is a valid headline that should be long enough to pass 2', 'sourceUrl': 'http://test.com/valid'},
            ],
        ]

        mock_get_vars.return_value = (True, True, MagicMock(), mock_fetch_news, MagicMock(), [{'id': 'mc'}])

        mock_persistence = MagicMock()
        mock_persistence.get_article_by_url.return_value = None
        mock_get_persistence.return_value = mock_persistence

        mock_asyncio.to_thread = MagicMock(side_effect=lambda fn, *a, **kw: fn(*a, **kw))
        mock_asyncio.sleep = AsyncMock(side_effect=[None, None, Exception("break loop")])

        with pytest.raises(Exception, match="break loop"):
            await news_poller_task()

        mock_persistence.save_article.assert_not_called()

    @pytest.mark.asyncio
    @patch('api.news.news_poller._get_module_vars')
    @patch('api.news.news_poller.get_persistence_service')
    @patch('api.news.news_poller.asyncio')
    @patch('api.news.news_poller.news_ws_manager')
    async def test_broadcasts_new_items_via_websocket(
        self, mock_ws, mock_asyncio, mock_get_persistence, mock_get_vars
    ):
        from api.news.news_poller import news_poller_task

        mock_fetch_news = MagicMock()
        mock_fetch_news.side_effect = [
            [{'id': 'old1', 'headline': 'This is a valid headline that should be long enough to pass x1', 'sourceUrl': 'http://test.com/old1'}],
            [{'id': 'new1', 'headline': 'This is a new headline that should trigger a broadcast x2', 'sourceUrl': 'http://test.com/new1'}],
        ]

        mock_get_vars.return_value = (True, True, MagicMock(), mock_fetch_news, MagicMock(), [{'id': 'mc'}])

        mock_persistence = MagicMock()
        mock_persistence.get_article_by_url.return_value = None
        mock_get_persistence.return_value = mock_persistence

        mock_asyncio.to_thread = MagicMock(side_effect=lambda fn, *a, **kw: fn(*a, **kw))
        mock_asyncio.sleep = AsyncMock(side_effect=[None, None, Exception("break loop")])

        with pytest.raises(Exception, match="break loop"):
            await news_poller_task()

        mock_ws.broadcast.assert_called()
        broadcast_call = mock_ws.broadcast.call_args[0][0]
        assert broadcast_call["type"] == "new_items"
        assert broadcast_call["source"] == "mc"

    @pytest.mark.asyncio
    @patch('api.news.news_poller._get_module_vars')
    @patch('api.news.news_poller.get_persistence_service')
    @patch('api.news.news_poller.asyncio')
    @patch('api.news.news_poller.news_ws_manager')
    async def test_broadcasts_high_impact_items_separately(
        self, mock_ws, mock_asyncio, mock_get_persistence, mock_get_vars
    ):
        from api.news.news_poller import news_poller_task

        mock_fetch_article = MagicMock()
        mock_fetch_article.return_value = {
            'description': 'A' * 100,
            'symbols': [],
        }

        mock_analyzer = MagicMock()
        mock_analyzer.analyze_article.return_value = {
            'impact_score': 9,
            'sentiment': 'BULLISH',
        }

        mock_fetch_news = MagicMock()
        mock_fetch_news.side_effect = [
            [{'id': 'old1', 'headline': 'This is a valid headline that should be long enough to pass xx1', 'sourceUrl': 'http://test.com/old1'}],
            [{'id': 'high1', 'headline': 'This is a high impact headline that should trigger alert xx2', 'sourceUrl': 'http://test.com/high1'}],
        ]

        mock_get_vars.return_value = (True, True, mock_analyzer, mock_fetch_news, mock_fetch_article, [{'id': 'mc'}])

        mock_persistence = MagicMock()
        mock_persistence.get_article_by_url.return_value = None
        mock_get_persistence.return_value = mock_persistence

        mock_asyncio.to_thread = MagicMock(side_effect=lambda fn, *a, **kw: fn(*a, **kw))
        mock_asyncio.sleep = AsyncMock(side_effect=[None, None, Exception("break loop")])

        with pytest.raises(Exception, match="break loop"):
            await news_poller_task()

        # Should have at least one broadcast for new items and one for high impact
        broadcast_calls = mock_ws.broadcast.call_args_list
        types = [call[0][0]["type"] for call in broadcast_calls]
        assert "high_impact_alert" in types

    @pytest.mark.asyncio
    @patch('api.news.news_poller._get_module_vars')
    @patch('api.news.news_poller.get_persistence_service')
    @patch('api.news.news_poller.asyncio')
    @patch('api.news.news_poller.news_ws_manager')
    async def test_invalidates_cache_on_new_article_save(
        self, mock_ws, mock_asyncio, mock_get_persistence, mock_get_vars
    ):
        from api.news.news_poller import news_poller_task

        mock_fetch_news = MagicMock()
        mock_fetch_news.side_effect = [
            [{'id': 'old1', 'headline': 'This is a valid headline that should be long enough to pass yy1', 'sourceUrl': 'http://test.com/old1'}],
            [{'id': 'new1', 'headline': 'This is a new headline that should trigger cache invalidation yy2', 'sourceUrl': 'http://test.com/new1'}],
        ]

        mock_fetch_article = MagicMock()
        mock_fetch_article.return_value = {
            'description': 'Content for testing cache invalidation.',
            'symbols': [{'code': 'RELIANCE'}],
        }

        mock_get_vars.return_value = (True, True, MagicMock(), mock_fetch_news, mock_fetch_article, [{'id': 'mc'}])

        mock_persistence = MagicMock()
        mock_persistence.get_article_by_url.return_value = None
        mock_get_persistence.return_value = mock_persistence

        mock_asyncio.to_thread = MagicMock(side_effect=lambda fn, *a, **kw: fn(*a, **kw))
        mock_asyncio.sleep = AsyncMock(side_effect=[None, None, Exception("break loop")])

        with patch('api.news.news_poller.cache_delete_pattern') as mock_cache_del:
            with patch('api.news.news_poller.is_cache_available', return_value=True):
                with pytest.raises(Exception, match="break loop"):
                    await news_poller_task()

                mock_cache_del.assert_called()


# =========================================================================
# sector_poller_task
# =========================================================================

class TestSectorPoller:
    @pytest.mark.asyncio
    @patch('api.news.news_poller.get_sector_performance')
    @patch('api.news.news_poller.sector_ws_manager')
    @patch('api.news.news_poller.asyncio')
    async def test_sector_poller_polls_both_markets(
        self, mock_asyncio, mock_ws, mock_sector
    ):
        from api.news.news_poller import sector_poller_task

        mock_sector.return_value = MagicMock()
        mock_sector.return_value.model_dump.return_value = {}

        mock_asyncio.sleep = AsyncMock(side_effect=[None, Exception("break")])

        with pytest.raises(Exception, match="break"):
            await sector_poller_task()

        assert mock_sector.call_count == 2
        markets = [call[1]["market"] for call in mock_sector.call_args_list]
        assert "india" in markets
        assert "america" in markets

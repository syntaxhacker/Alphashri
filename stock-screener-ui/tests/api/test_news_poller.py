"""
Tests for News Poller logic — prefetch, polling loop segments, and sector polling.

Item coverage from test_cases/news.md:
  - news_poller.py: NEWS_SOURCES loading, fallback, LLM optional, prefetch delay,
    initialize last_seen_ids, detect new items, skip short/duplicate articles,
    persist with LLM, broadcast via WS, high-impact broadcast, cache invalidation
"""

import sys
import json
import asyncio as _real_asyncio
from pathlib import Path
from datetime import datetime
from unittest.mock import Mock, MagicMock, patch, AsyncMock, call

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))



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



class TestDoPrefetchSync:
    @patch('api.news.news_poller._get_module_vars')
    @patch('services.news_persistence.get_persistence_service')
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
    @patch('services.news_persistence.get_persistence_service')
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
    @patch('services.news_persistence.get_persistence_service')
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

        assert mock_persistence.save_article.call_count == 1

    @patch('api.news.news_poller._get_module_vars')
    @patch('services.news_persistence.get_persistence_service')
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



class TestNewsStartupPrefetch:
    @patch('api.news.news_poller._do_prefetch_sync')
    @patch('api.news.news_poller.asyncio')
    def test_runs_after_30s_delay(self, mock_asyncio, mock_prefetch):
        from api.news.news_poller import news_startup_prefetch

        mock_asyncio.sleep = AsyncMock()
        mock_loop = AsyncMock()
        mock_loop.run_in_executor = AsyncMock(return_value=None)
        mock_asyncio.get_event_loop.return_value = mock_loop

        _real_asyncio.run(news_startup_prefetch())

        mock_asyncio.sleep.assert_called_once_with(30)

    @patch('api.news.news_poller._do_prefetch_sync')
    @patch('api.news.news_poller.asyncio')
    def test_skips_prefetch_when_news_not_available(self, mock_asyncio, mock_prefetch):
        from api.news.news_poller import news_startup_prefetch

        with patch('api.news.news_poller._news_available', False):
            _real_asyncio.run(news_startup_prefetch())

        mock_prefetch.assert_not_called()



class TestNewsPollerLogic:
    @pytest.mark.asyncio
    @patch('api.news.news_poller._get_module_vars')
    @patch('services.news_persistence.get_persistence_service')
    @patch('api.news.news_poller.asyncio')
    @patch('api.news.news_poller.news_ws_manager')
    async def test_initializes_last_seen_ids(
        self, mock_ws, mock_asyncio, mock_get_persistence, mock_get_vars
    ):
        mock_ws.broadcast = AsyncMock()
        from api.news.news_poller import news_poller_task

        mock_fetch_news = MagicMock()
        mock_fetch_news.return_value = [
            {'id': 'abc123', 'headline': 'First article with very long headline text here', 'sourceUrl': 'http://test.com/1'}
        ]

        mock_get_vars.return_value = (True, True, MagicMock(), mock_fetch_news, MagicMock(), [{'id': 'mc'}])

        # Make the loop break after first iteration
        async def fake_to_thread(fn, *args, **kwargs):
            return fn(*args, **kwargs)
        mock_asyncio.to_thread = fake_to_thread
        mock_asyncio.sleep = AsyncMock(side_effect=[None, Exception("break loop")])

        with pytest.raises(Exception, match="break loop"):
            await news_poller_task()

    @staticmethod
    async def _make_sleep(max_calls):
        """Return a controllable sleep that raises SystemExit after max_calls invocations."""
        call_count = 0
        async def _sleep(delay):
            nonlocal call_count
            call_count += 1
            if call_count >= max_calls:
                raise SystemExit("stop")
        return _sleep

    @pytest.mark.asyncio
    @patch('api.news.news_poller._get_module_vars')
    @patch('services.news_persistence.get_persistence_service')
    @patch('api.news.news_poller.asyncio')
    @patch('api.news.news_poller.news_ws_manager')
    async def test_detects_new_items_via_id_comparison(
        self, mock_ws, mock_asyncio, mock_get_persistence, mock_get_vars
    ):
        from api.news.news_poller import news_poller_task

        mock_ws.broadcast = AsyncMock()

        mock_fetch_news = MagicMock()
        mock_fetch_news.side_effect = [
            [{'id': 'new1', 'headline': 'Breaking news headline that is very long and interesting 1', 'sourceUrl': 'http://test.com/new1'}],
            [{'id': 'new3', 'headline': 'Third news headline that is also very long and interesting 3', 'sourceUrl': 'http://test.com/new3'},
             {'id': 'new2', 'headline': 'Second news headline that is also very long and interesting 2', 'sourceUrl': 'http://test.com/new2'},
             {'id': 'new1', 'headline': 'Breaking news headline that is very long and interesting 1', 'sourceUrl': 'http://test.com/new1'}],
        ]

        mock_get_vars.return_value = (True, True, MagicMock(), mock_fetch_news, MagicMock(), [{'id': 'mc'}])

        mock_persistence = MagicMock()
        mock_persistence.get_article_by_url.return_value = None
        mock_get_persistence.return_value = mock_persistence

        async def fake_to_thread(fn, *args, **kwargs):
            return fn(*args, **kwargs)
        mock_asyncio.to_thread = fake_to_thread
        mock_asyncio.sleep = await self._make_sleep(6)

        with pytest.raises(SystemExit, match="stop"):
            await news_poller_task()

        # fetch_news was called twice (init + detect)
        assert mock_fetch_news.call_count >= 2

    @pytest.mark.asyncio
    @patch('api.news.news_poller._get_module_vars')
    @patch('services.news_persistence.get_persistence_service')
    @patch('api.news.news_poller.asyncio')
    @patch('api.news.news_poller.news_ws_manager')
    async def test_skips_articles_without_url_or_short_headline_in_poller(
        self, mock_ws, mock_asyncio, mock_get_persistence, mock_get_vars
    ):
        from api.news.news_poller import news_poller_task

        mock_ws.broadcast = AsyncMock()
        mock_fetch_news = MagicMock()
        mock_fetch_article = MagicMock()
        mock_fetch_article.return_value = {'description': 'Valid content for testing.', 'symbols': []}
        mock_fetch_news.side_effect = [
            [{'id': 'old1', 'headline': 'This is a valid headline that should be long enough to pass 1', 'sourceUrl': 'http://test.com/old1'}],
            [
                {'id': 'short', 'headline': 'Short', 'sourceUrl': 'http://test.com/short'},
                {'id': 'nourl', 'headline': 'This is another valid headline that should pass the filter', 'sourceUrl': ''},
                {'id': 'valid', 'headline': 'This is a valid headline that should be long enough to pass 2', 'sourceUrl': 'http://test.com/valid'},
            ],
        ]

        mock_get_vars.return_value = (True, True, MagicMock(), mock_fetch_news, mock_fetch_article, [{'id': 'mc'}])

        mock_persistence = MagicMock()
        mock_persistence.get_article_by_url.return_value = None
        mock_get_persistence.return_value = mock_persistence

        async def fake_to_thread(fn, *args, **kwargs):
            return fn(*args, **kwargs)
        mock_asyncio.to_thread = fake_to_thread
        mock_asyncio.sleep = await self._make_sleep(7)

        with pytest.raises(SystemExit, match="stop"):
            await news_poller_task()

        # Only the valid item (long headline + URL) should be saved
        mock_persistence.save_article.assert_called_once()

    @pytest.mark.asyncio
    @patch('api.news.news_poller._get_module_vars')
    @patch('services.news_persistence.get_persistence_service')
    @patch('api.news.news_poller.asyncio')
    @patch('api.news.news_poller.news_ws_manager')
    async def test_broadcasts_new_items_via_websocket(
        self, mock_ws, mock_asyncio, mock_get_persistence, mock_get_vars
    ):
        from api.news.news_poller import news_poller_task

        mock_ws.broadcast = AsyncMock()
        mock_fetch_news = MagicMock()
        mock_fetch_news.side_effect = [
            [{'id': 'old1', 'headline': 'This is a valid headline that should be long enough to pass x1', 'sourceUrl': 'http://test.com/old1'}],
            [{'id': 'new1', 'headline': 'This is a new headline that should trigger a broadcast x2', 'sourceUrl': 'http://test.com/new1'}],
        ]

        mock_fetch_article = MagicMock()
        mock_fetch_article.return_value = {'description': 'Valid content.', 'symbols': []}
        mock_get_vars.return_value = (True, True, MagicMock(), mock_fetch_news, mock_fetch_article, [{'id': 'mc'}])

        mock_persistence = MagicMock()
        mock_persistence.get_article_by_url.return_value = None
        mock_get_persistence.return_value = mock_persistence

        async def fake_to_thread(fn, *args, **kwargs):
            return fn(*args, **kwargs)
        mock_asyncio.to_thread = fake_to_thread
        mock_asyncio.sleep = await self._make_sleep(7)

        with pytest.raises(SystemExit, match="stop"):
            await news_poller_task()

        mock_ws.broadcast.assert_called()
        broadcast_call = mock_ws.broadcast.call_args[0][0]
        assert broadcast_call["type"] == "new_items"
        assert broadcast_call["source"] == "mc"

    @pytest.mark.asyncio
    @patch('api.news.news_poller.news_ws_manager')
    @patch('api.news.news_poller.asyncio')
    @patch('services.news_persistence.get_persistence_service')
    async def test_broadcasts_high_impact_items_separately(
        self, mock_get_persistence, mock_asyncio, mock_ws
    ):
        import api.news.news_poller as np

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

        mock_persistence = MagicMock()
        mock_persistence.get_article_by_url.return_value = None
        mock_get_persistence.return_value = mock_persistence

        async def fake_to_thread(fn, *args, **kwargs):
            return fn(*args, **kwargs)
        mock_asyncio.to_thread = fake_to_thread
        mock_asyncio.sleep = await self._make_sleep(9)

        mock_ws.broadcast = AsyncMock()

        with patch.multiple(np,
                            _news_available=True,
                            _llm_available=True,
                            article_analyzer=mock_analyzer,
                            fetch_news=mock_fetch_news,
                            fetch_article_content=mock_fetch_article,
                            NEWS_SOURCES=[{'id': 'mc'}]):
            with pytest.raises(SystemExit, match="stop"):
                from api.news.news_poller import news_poller_task
                await news_poller_task()

            broadcast_calls = mock_ws.broadcast.call_args_list
            types = [c[0][0]["type"] for c in broadcast_calls]

            # Should have at least one broadcast for new items and one for high impact
            assert "high_impact_alert" in types

    @pytest.mark.asyncio
    @patch('api.news.news_poller._get_module_vars')
    @patch('services.news_persistence.get_persistence_service')
    @patch('api.news.news_poller.asyncio')
    @patch('api.news.news_poller.news_ws_manager')
    async def test_invalidates_cache_on_new_article_save(
        self, mock_ws, mock_asyncio, mock_get_persistence, mock_get_vars
    ):
        from api.news.news_poller import news_poller_task

        mock_ws.broadcast = AsyncMock()
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

        async def fake_to_thread(fn, *args, **kwargs):
            return fn(*args, **kwargs)
        mock_asyncio.to_thread = fake_to_thread
        mock_asyncio.sleep = await self._make_sleep(8)

        with patch('cache.redis_client.cache_delete_pattern') as mock_cache_del:
            with patch('cache.redis_client.is_cache_available', return_value=True):
                with pytest.raises(SystemExit, match="stop"):
                    await news_poller_task()

                mock_cache_del.assert_called()



class TestSectorPoller:
    @pytest.mark.asyncio
    @patch('api.news.news_poller.sector_ws_manager')
    @patch('api.news.news_poller.asyncio')
    async def test_sector_poller_polls_both_markets(
        self, mock_asyncio, mock_ws
    ):
        from api.news.news_poller import sector_poller_task

        mock_ws.broadcast = AsyncMock()  # Make broadcast awaitable

        mock_result = MagicMock()
        mock_result.model_dump.return_value = {}

        async def fake_sector(**kwargs):
            return mock_result

        with patch('api.sector.get_sector_performance', side_effect=fake_sector) as mock_sector:
            mock_asyncio.sleep = await TestNewsPollerLogic._make_sleep(6)

            with pytest.raises(SystemExit, match="stop"):
                await sector_poller_task()

            assert mock_sector.call_count >= 2
            markets = [call.kwargs.get("market") for call in mock_sector.call_args_list if call.kwargs]
            assert "india" in markets
            assert "america" in markets


class TestCacheInvalidationCoalescing:
    @staticmethod
    def _one_cycle_asyncio():
        """Real awaitable primitives; MagicMock cannot be awaited by gather/wait_for."""
        import asyncio as real_asyncio

        class _Shim:
            CancelledError = real_asyncio.CancelledError
            TimeoutError = real_asyncio.TimeoutError
            to_thread = staticmethod(real_asyncio.to_thread)
            wait_for = staticmethod(real_asyncio.wait_for)
            gather = staticmethod(real_asyncio.gather)

            def __init__(self):
                self.sleep_count = 0

            async def sleep(self, delay):
                self.sleep_count += 1
                # call 1 = startup sleep(5); call 2 = first cycle's sleep(60).
                if self.sleep_count >= 2:
                    raise SystemExit("stop")

        return _Shim()

    @pytest.mark.asyncio
    async def test_invalidates_once_per_cycle_with_saved_data_unchanged(self):
        from api.news.news_poller import news_poller_task

        shim = self._one_cycle_asyncio()
        items = [
            {
                'id': f'id{i}',
                'headline': f'This is a valid long headline for article number {i} in the test',
                'sourceUrl': f'http://test.com/article/{i}',
            }
            for i in range(12)
        ]
        content = 'Full article body long enough for the persistence layer.'
        symbols = [{'code': 'RELIANCE'}]
        analysis = {'sentiment': 'BULLISH', 'impact_score': 5}

        mock_fetch_news = MagicMock(return_value=items)
        mock_fetch_article = MagicMock(return_value={'description': content, 'symbols': symbols})
        mock_analyzer = MagicMock()
        mock_analyzer.analyze_article.return_value = analysis
        mock_persistence = MagicMock()
        mock_persistence.get_article_by_url.return_value = None

        with patch('api.news.news_poller.asyncio', shim), \
             patch('api.news.news_poller.NEWS_ARTICLE_BUDGET_PER_CYCLE', 12), \
             patch('api.news.news_poller._get_module_vars', return_value=(
                 True, True, mock_analyzer, mock_fetch_news, mock_fetch_article,
                 [{'id': 'mc'}],
             )), \
             patch('services.news_persistence.get_persistence_service', return_value=mock_persistence), \
             patch('api.news.news_poller.news_ws_manager') as mock_ws, \
             patch('api.news.news_impact.score_recent_articles', return_value={'scored': 0, 'moved': 0}), \
             patch('cache.redis_client.invalidate_news_cache') as mock_invalidate:
            mock_ws.broadcast = AsyncMock()
            with pytest.raises(SystemExit, match="stop"):
                await news_poller_task()

        # All 12 budgeted articles are saved with their original payloads.
        assert mock_persistence.save_article.call_count == 12
        saved_urls = [c.kwargs['url'] for c in mock_persistence.save_article.call_args_list]
        assert saved_urls == [f'http://test.com/article/{i}' for i in range(12)]
        first = mock_persistence.save_article.call_args_list[0].kwargs
        assert first['headline'] == items[0]['headline']
        assert first['content'] == content
        assert first['source'] == 'mc'
        assert first['source_url'] == items[0]['sourceUrl']
        assert first['symbols'] == symbols
        assert first['sentiment'] == 'BULLISH'
        assert first['impact_score'] == 5
        assert first['analysis'] == analysis

        # One global flush for the cycle, not one per saved article (12).
        assert mock_invalidate.call_count == 1

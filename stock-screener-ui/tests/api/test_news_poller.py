"""
Tests for News Poller logic — prefetch, polling loop segments, and sector polling.

Item coverage from test_cases/news.md:
  - news_poller.py: NEWS_SOURCES loading, fallback, LLM optional, prefetch delay,
    initialize last_seen_ids, detect new items, skip short/duplicate articles,
    persist with LLM, broadcast via WS, high-impact broadcast, cache invalidation

The poller catches ``asyncio.CancelledError``/``asyncio.TimeoutError``. Patching
the whole ``asyncio`` module turns those into ``except MagicMock()`` (TypeError),
so tests patch a shim that keeps the real exception classes and real awaitable
primitives while making ``sleep`` controllable.
"""

import sys
import asyncio as _real_asyncio
from pathlib import Path
from unittest.mock import MagicMock, patch, AsyncMock

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


class _PollerAsyncio:
    """Stand-in for the poller's asyncio: real exceptions + awaitables, fake time."""

    CancelledError = _real_asyncio.CancelledError
    TimeoutError = _real_asyncio.TimeoutError

    def __init__(self, stop_after=None):
        self.stop_after = stop_after
        self.sleep_calls = 0
        self.sleep_delays = []

    @staticmethod
    async def to_thread(fn, *args, **kwargs):
        return fn(*args, **kwargs)

    @staticmethod
    async def wait_for(awaitable, timeout):
        return await _real_asyncio.wait_for(awaitable, timeout)

    @staticmethod
    async def gather(*awaitables):
        return await _real_asyncio.gather(*awaitables)

    @staticmethod
    def get_event_loop():
        return _real_asyncio.get_event_loop()

    async def sleep(self, delay):
        self.sleep_delays.append(delay)
        self.sleep_calls += 1
        if self.stop_after is not None and self.sleep_calls >= self.stop_after:
            raise SystemExit("stop")


@pytest.fixture
def poller_asyncio(monkeypatch):
    """Replace only the poller's asyncio entry points; keep real exception classes."""
    shim = _PollerAsyncio()
    monkeypatch.setattr('api.news.news_poller.asyncio', shim)
    return shim


@pytest.fixture(autouse=True)
def _isolate_poller(monkeypatch):
    """No real DB/network work and no leaked poller state between tests."""
    import api.news.news_poller as np

    task = np.news_poller_task
    task._dead_sources = set()
    for name in list(vars(task)):
        if name.startswith('_empty_count_'):
            delattr(task, name)
    monkeypatch.setattr(
        'api.news.news_impact.score_recent_articles',
        lambda: {'scored': 0, 'moved': 0},
    )
    yield
    task._dead_sources = set()


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


def _poller_vars(fetch_news, fetch_article=None, analyzer=None, sources=None):
    """Build the tuple ``_get_module_vars`` is expected to return."""
    return (
        True,
        True,
        analyzer or MagicMock(
            analyze_article=MagicMock(
                return_value={'sentiment': 'BULLISH', 'impact_score': 5}
            )
        ),
        fetch_news,
        fetch_article or MagicMock(
            return_value={'description': 'Valid content for testing.', 'symbols': []}
        ),
        sources or [{'id': 'mc'}],
    )


def _article(item_id, headline_tail=""):
    return {
        'id': item_id,
        'headline': f'A sufficiently long headline for {item_id} {headline_tail}'.strip(),
        'sourceUrl': f'http://test.com/{item_id}',
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
    def test_runs_after_30s_delay(self, mock_prefetch, poller_asyncio):
        from api.news.news_poller import news_startup_prefetch

        _real_asyncio.run(news_startup_prefetch())

        assert poller_asyncio.sleep_delays == [30]
        mock_prefetch.assert_called_once()

    @patch('api.news.news_poller._do_prefetch_sync')
    def test_skips_prefetch_when_news_not_available(self, mock_prefetch, poller_asyncio):
        from api.news.news_poller import news_startup_prefetch

        with patch('api.news.news_poller._news_available', False):
            _real_asyncio.run(news_startup_prefetch())

        mock_prefetch.assert_not_called()
        assert poller_asyncio.sleep_delays == []


class TestNewsPollerLogic:
    @patch('api.news.news_poller._get_module_vars')
    @patch('services.news_persistence.get_persistence_service')
    @patch('api.news.news_poller.news_ws_manager')
    async def test_initializes_last_seen_ids(
        self, mock_ws, mock_get_persistence, mock_get_vars, poller_asyncio
    ):
        poller_asyncio.stop_after = 2  # startup sleep + one completed cycle
        mock_ws.broadcast = AsyncMock()
        from api.news.news_poller import news_poller_task

        mock_fetch_news = MagicMock(return_value=[_article('abc123')])
        mock_get_vars.return_value = _poller_vars(mock_fetch_news)
        mock_persistence = MagicMock()
        mock_persistence.get_article_by_url.return_value = None
        mock_get_persistence.return_value = mock_persistence

        with pytest.raises(SystemExit, match="stop"):
            await news_poller_task()

        mock_fetch_news.assert_called_once()
        mock_persistence.save_article.assert_called_once()

    @patch('api.news.news_poller._get_module_vars')
    @patch('services.news_persistence.get_persistence_service')
    @patch('api.news.news_poller.news_ws_manager')
    async def test_detects_new_items_via_id_comparison(
        self, mock_ws, mock_get_persistence, mock_get_vars, poller_asyncio
    ):
        poller_asyncio.stop_after = 3  # two completed cycles
        mock_ws.broadcast = AsyncMock()
        from api.news.news_poller import news_poller_task

        mock_fetch_news = MagicMock(side_effect=[
            [_article('new1', '1')],
            [_article('new3', '3'), _article('new2', '2'), _article('new1', '1')],
        ])
        mock_get_vars.return_value = _poller_vars(mock_fetch_news)
        mock_persistence = MagicMock()
        mock_persistence.get_article_by_url.return_value = None
        mock_get_persistence.return_value = mock_persistence

        with pytest.raises(SystemExit, match="stop"):
            await news_poller_task()

        assert mock_fetch_news.call_count == 2
        # The second cycle walks the whole batch, so all three ids are seen.
        seen_ids = {item['id'] for item in mock_ws.broadcast.call_args[0][0]['items']}
        assert seen_ids == {'new1', 'new2', 'new3'}

    @patch('api.news.news_poller._get_module_vars')
    @patch('services.news_persistence.get_persistence_service')
    @patch('api.news.news_poller.news_ws_manager')
    async def test_skips_articles_without_url_or_short_headline_in_poller(
        self, mock_ws, mock_get_persistence, mock_get_vars, poller_asyncio
    ):
        poller_asyncio.stop_after = 2
        mock_ws.broadcast = AsyncMock()
        from api.news.news_poller import news_poller_task

        mock_fetch_news = MagicMock(return_value=[
            {'id': 'short', 'headline': 'Short', 'sourceUrl': 'http://test.com/short'},
            {'id': 'nourl', 'headline': 'A valid long headline that would otherwise pass', 'sourceUrl': ''},
            _article('valid'),
        ])
        mock_get_vars.return_value = _poller_vars(mock_fetch_news)
        mock_persistence = MagicMock()
        mock_persistence.get_article_by_url.return_value = None
        mock_get_persistence.return_value = mock_persistence

        with pytest.raises(SystemExit, match="stop"):
            await news_poller_task()

        mock_persistence.save_article.assert_called_once()
        assert mock_persistence.save_article.call_args.kwargs['url'] == 'http://test.com/valid'

    @patch('api.news.news_poller._get_module_vars')
    @patch('services.news_persistence.get_persistence_service')
    @patch('api.news.news_poller.news_ws_manager')
    async def test_broadcasts_new_items_via_websocket(
        self, mock_ws, mock_get_persistence, mock_get_vars, poller_asyncio
    ):
        poller_asyncio.stop_after = 3
        mock_ws.broadcast = AsyncMock()
        from api.news.news_poller import news_poller_task

        mock_fetch_news = MagicMock(side_effect=[
            [_article('old1')],
            [_article('new1')],
        ])
        mock_get_vars.return_value = _poller_vars(mock_fetch_news)
        mock_persistence = MagicMock()
        mock_persistence.get_article_by_url.return_value = None
        mock_get_persistence.return_value = mock_persistence

        with pytest.raises(SystemExit, match="stop"):
            await news_poller_task()

        mock_ws.broadcast.assert_called()
        broadcast_call = mock_ws.broadcast.call_args[0][0]
        assert broadcast_call["type"] == "new_items"
        assert broadcast_call["source"] == "mc"

    @patch('api.news.news_poller.news_ws_manager')
    async def test_broadcasts_high_impact_items_separately(
        self, mock_ws, poller_asyncio
    ):
        import api.news.news_poller as np

        poller_asyncio.stop_after = 3
        mock_ws.broadcast = AsyncMock()
        mock_fetch_news = MagicMock(side_effect=[
            [_article('old1')],
            [_article('high1')],
        ])
        mock_analyzer = MagicMock()
        mock_analyzer.analyze_article.return_value = {
            'impact_score': 9,
            'sentiment': 'BULLISH',
        }

        with patch.multiple(np,
                            _news_available=True,
                            _llm_available=True,
                            article_analyzer=mock_analyzer,
                            fetch_news=mock_fetch_news,
                            fetch_article_content=MagicMock(
                                return_value={'description': 'A' * 100, 'symbols': []}
                            ),
                            NEWS_SOURCES=[{'id': 'mc'}]), \
             patch('services.news_persistence.get_persistence_service') as mock_get_persistence:
            mock_persistence = MagicMock()
            mock_persistence.get_article_by_url.return_value = None
            mock_get_persistence.return_value = mock_persistence

            with pytest.raises(SystemExit, match="stop"):
                from api.news.news_poller import news_poller_task
                await news_poller_task()

            types = [c[0][0]["type"] for c in mock_ws.broadcast.call_args_list]
            assert "new_items" in types
            assert "high_impact_alert" in types

    @patch('api.news.news_poller._get_module_vars')
    @patch('services.news_persistence.get_persistence_service')
    @patch('api.news.news_poller.news_ws_manager')
    async def test_invalidates_cache_on_new_article_save(
        self, mock_ws, mock_get_persistence, mock_get_vars, poller_asyncio
    ):
        poller_asyncio.stop_after = 3
        mock_ws.broadcast = AsyncMock()
        from api.news.news_poller import news_poller_task

        mock_fetch_news = MagicMock(side_effect=[
            [_article('old1')],
            [_article('new1')],
        ])
        mock_get_vars.return_value = _poller_vars(mock_fetch_news)
        mock_persistence = MagicMock()
        mock_persistence.get_article_by_url.return_value = None
        mock_get_persistence.return_value = mock_persistence

        with patch('cache.redis_client.cache_delete_pattern') as mock_cache_del:
            with patch('cache.redis_client.is_cache_available', return_value=True):
                with pytest.raises(SystemExit, match="stop"):
                    await news_poller_task()

                mock_cache_del.assert_called()


class TestSectorPoller:
    @patch('api.news.news_poller.sector_ws_manager')
    async def test_sector_poller_polls_both_markets(self, mock_ws, poller_asyncio):
        from api.news.news_poller import sector_poller_task

        poller_asyncio.stop_after = 2
        mock_ws.broadcast = AsyncMock()
        mock_result = MagicMock()
        mock_result.model_dump.return_value = {}

        async def fake_sector(**kwargs):
            return mock_result

        with patch('api.sector.get_sector_performance', side_effect=fake_sector) as mock_sector:
            with pytest.raises(SystemExit, match="stop"):
                await sector_poller_task()

            assert mock_sector.call_count >= 2
            markets = [c.kwargs.get("market") for c in mock_sector.call_args_list if c.kwargs]
            assert "india" in markets
            assert "america" in markets


class TestCacheInvalidationCoalescing:
    @patch('api.news.news_poller._get_module_vars')
    @patch('services.news_persistence.get_persistence_service')
    @patch('api.news.news_poller.news_ws_manager')
    async def test_invalidates_once_per_cycle_with_saved_data_unchanged(
        self, mock_ws, mock_get_persistence, mock_get_vars, poller_asyncio
    ):
        from api.news.news_poller import news_poller_task

        poller_asyncio.stop_after = 2  # one cycle
        mock_ws.broadcast = AsyncMock()
        items = [_article(f'id{i}') for i in range(12)]
        content = 'Full article body long enough for the persistence layer.'
        symbols = [{'code': 'RELIANCE'}]
        analysis = {'sentiment': 'BULLISH', 'impact_score': 5}

        mock_fetch_news = MagicMock(return_value=items)
        mock_fetch_article = MagicMock(return_value={'description': content, 'symbols': symbols})
        mock_analyzer = MagicMock()
        mock_analyzer.analyze_article.return_value = analysis
        mock_get_vars.return_value = (True, True, mock_analyzer, mock_fetch_news,
                                      mock_fetch_article, [{'id': 'mc'}])
        mock_persistence = MagicMock()
        mock_persistence.get_article_by_url.return_value = None
        mock_get_persistence.return_value = mock_persistence

        with patch('api.news.news_poller.NEWS_ARTICLE_BUDGET_PER_CYCLE', 12), \
             patch('cache.redis_client.invalidate_news_cache') as mock_invalidate:
            with pytest.raises(SystemExit, match="stop"):
                await news_poller_task()

        assert mock_persistence.save_article.call_count == 12
        saved_urls = [c.kwargs['url'] for c in mock_persistence.save_article.call_args_list]
        assert saved_urls == [f'http://test.com/id{i}' for i in range(12)]
        first = mock_persistence.save_article.call_args_list[0].kwargs
        assert first['headline'] == items[0]['headline']
        assert first['content'] == content
        assert first['source'] == 'mc'
        assert first['source_url'] == items[0]['sourceUrl']
        assert first['symbols'] == symbols
        assert first['sentiment'] == 'BULLISH'
        assert first['impact_score'] == 5
        assert first['analysis'] == analysis

        assert mock_invalidate.call_count == 1

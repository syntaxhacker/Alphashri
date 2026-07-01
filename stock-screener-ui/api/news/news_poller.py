"""
Background poller tasks: news prefetch, continuous polling, and sector polling.
"""

import asyncio
import concurrent.futures
import logging
import os
from datetime import datetime
from typing import Dict

from api.news.news_ws import news_ws_manager, sector_ws_manager
from api.screener import _sanitize_for_json


_project_root = None
_news_available = False
_llm_available = False
article_analyzer = None
fetch_news = None
fetch_article_content = None
NEWS_SOURCES = []

try:
    import sys
    from pathlib import Path as PathlibPath
    _project_root = PathlibPath(__file__).resolve().parent.parent.parent.parent
    _news_module_path = _project_root / 'moneycontrol-scraper'
    if str(_news_module_path) not in sys.path:
        sys.path.insert(0, str(_news_module_path))

    from news_api import fetch_news as _fetch_news, fetch_article_content as _fetch_article_content, NEWS_SOURCES as _NEWS_SOURCES
    fetch_news = _fetch_news
    fetch_article_content = _fetch_article_content
    NEWS_SOURCES = _NEWS_SOURCES

    try:
        from llm_analyzer import article_analyzer as _aa
        _llm_available = True
        article_analyzer = _aa
        print("✅ LLM Analyzer module loaded")
    except ImportError as e:
        _llm_available = False
        article_analyzer = None
        print(f"⚠️ LLM Analyzer module not available: {e}")

    _news_available = True
    print("✅ News API module loaded")
except ImportError as e:
    _news_available = False
    _llm_available = False
    article_analyzer = None
    fetch_news = None
    fetch_article_content = None
    NEWS_SOURCES = []
    print(f"⚠️ News API module not available: {e}")


def _get_module_vars():
    return _news_available, _llm_available, article_analyzer, fetch_news, fetch_article_content, NEWS_SOURCES


def _init_news_modules():
    return _get_module_vars()


async def sector_poller_task():
    from api.sector import get_sector_performance

    await asyncio.sleep(10)

    while True:
        try:
            for market in ["india", "america"]:
                try:
                    data = await get_sector_performance(market=market)
                    await sector_ws_manager.broadcast({
                        "type": "sector_update",
                        "market": market,
                        "data": _sanitize_for_json(data.model_dump()),
                        "timestamp": datetime.now().isoformat()
                    })
                except Exception as e:
                    print(f"⚠️ Error polling sector data for {market}: {e}")

            await asyncio.sleep(60)
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"⚠️ Sector poller error: {e}")
            await asyncio.sleep(10)


def _do_prefetch_sync():
    from services.news_persistence import get_persistence_service

    _news_available, _llm_available, article_analyzer, fetch_news, fetch_article_content, NEWS_SOURCES = _get_module_vars()

    persistence = get_persistence_service()

    stats = persistence.get_article_stats()
    existing_count = stats.get('total_articles', 0)

    if existing_count > 50:
        print(f"📰 DB already has {existing_count} articles, skipping prefetch")
        return

    print(f"📰 Starting prefetch (DB has {existing_count} articles)...")

    source_ids = [s['id'] for s in NEWS_SOURCES] if NEWS_SOURCES and isinstance(NEWS_SOURCES, list) else ['moneycontrol']
    total_saved = 0

    for source_id in source_ids:
        try:
            items = fetch_news(source=source_id, limit=15)
            if not items:
                continue

            for item in items:
                try:
                    url = item.get('sourceUrl', '')
                    headline = item.get('headline', '')

                    if not url or len(headline) < 30:
                        continue

                    if persistence.get_article_by_url(url):
                        continue

                    from news_api import fetch_article_content
                    full_article = fetch_article_content(url)
                    content = full_article.get('description', '')
                    symbols = full_article.get('symbols', [])

                    analysis = None
                    if _llm_available and article_analyzer:
                        try:
                            analysis = article_analyzer.analyze_article(url, headline, content)
                        except Exception as e:
                            print(f"LLM analysis failed for {url[:50]}: {e}")

                    persistence.save_article(
                        url=url,
                        headline=headline,
                        content=content,
                        source=source_id,
                        source_url=url,
                        symbols=symbols,
                        sentiment=analysis.get('sentiment') if analysis else None,
                        impact_score=analysis.get('impact_score') if analysis else None,
                        analysis=analysis
                    )
                    total_saved += 1

                except Exception:
                    pass

            print(f"📰 Prefetched from {source_id}")

        except Exception as e:
            print(f"⚠️ Prefetch error for {source_id}: {e}")

    print(f"📰 Prefetch complete: {total_saved} new articles saved")


async def news_startup_prefetch():
    if not _news_available:
        print("📰 News not available, skipping prefetch")
        return

    await asyncio.sleep(30)
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _do_prefetch_sync)


async def news_poller_task():
    from news_api import fetch_article_content
    from services.news_persistence import get_persistence_service

    _news_available, _llm_available, article_analyzer, fetch_news, fetch_article_content, NEWS_SOURCES = _get_module_vars()

    poller_logger = logging.getLogger('news_poller')
    poller_logger.setLevel(logging.INFO)
    if not poller_logger.handlers:
        log_dir = os.path.join(os.path.dirname(__file__), '..', 'logs')
        os.makedirs(log_dir, exist_ok=True)
        fh = logging.FileHandler(os.path.join(log_dir, 'news_poller.log'))
        fh.setFormatter(logging.Formatter('%(asctime)s | %(levelname)s | %(message)s'))
        poller_logger.addHandler(fh)

    persistence = get_persistence_service()
    last_seen_ids: Dict[str, str] = {}
    poller_logger.info("News poller started")

    await asyncio.sleep(5)

    _poller_executor = concurrent.futures.ThreadPoolExecutor(max_workers=3, thread_name_prefix="news_poller")

    while True:
        try:
            if not _news_available:
                await asyncio.sleep(60)
                continue

            source_ids = [s['id'] for s in NEWS_SOURCES] if NEWS_SOURCES and isinstance(NEWS_SOURCES, list) else ['moneycontrol']

            # Skip sources that consistently return nothing (tracked across cycles)
            if not hasattr(news_poller_task, '_dead_sources'):
                news_poller_task._dead_sources = set()
            active_sources = [s for s in source_ids if s not in news_poller_task._dead_sources]

            async def _fetch_source(source_id: str) -> tuple:
                """Fetch a single source with timeout."""
                try:
                    items = await asyncio.wait_for(
                        asyncio.to_thread(fetch_news, source=source_id, limit=20),
                        timeout=15,
                    )
                    return source_id, items or []
                except asyncio.TimeoutError:
                    return source_id, []
                except Exception as e:
                    poller_logger.warning(f"Error fetching {source_id}: {e}")
                    return source_id, []

            results = await asyncio.gather(*[_fetch_source(s) for s in active_sources])

            async def _process_source(source_id: str, items: list):
                """Process fetched items for a single source."""
                key = f"_empty_count_{source_id}"
                if not items:
                    count = getattr(news_poller_task, key, 0) + 1
                    setattr(news_poller_task, key, count)
                    if count >= 3:
                        news_poller_task._dead_sources.add(source_id)
                    poller_logger.warning(f"No items returned from {source_id} (empty count: {count})")
                    return

                setattr(news_poller_task, key, 0)
                news_poller_task._dead_sources.discard(source_id)

                current_top_id = items[0].get('id')
                last_id = last_seen_ids.get(source_id)

                if last_id is None:
                    last_seen_ids[source_id] = current_top_id
                    poller_logger.info(f"Initialized tracking for {source_id}, top_id={current_top_id}")
                    return

                if current_top_id == last_id:
                    return

                new_items = []
                for item in items:
                    if item.get('id') == last_id:
                        break
                    new_items.append(item)
                if not new_items:
                    return

                poller_logger.info(f"Found {len(new_items)} new items from {source_id}")
                high_impact_items = []
                saved_count = 0
                skipped_count = 0

                for item in new_items:
                    try:
                        headline = item.get('headline', '')
                        url = item.get('sourceUrl', '')
                        if not url or len(headline) < 30:
                            skipped_count += 1
                            continue

                        existing = persistence.get_article_by_url(url)
                        if existing:
                            continue

                        full_article = await asyncio.to_thread(fetch_article_content, url)
                        content = full_article.get('description', '')
                        symbols = full_article.get('symbols', [])
                        if 'error' in full_article or not content:
                            skipped_count += 1
                            continue

                        published_at = None
                        if full_article.get('publishedAt'):
                            try:
                                published_at = datetime.fromisoformat(full_article['publishedAt'].replace('Z', '+00:00'))
                            except Exception:
                                pass

                        analysis = None
                        if _llm_available and article_analyzer:
                            try:
                                analysis = await asyncio.to_thread(article_analyzer.analyze_article, url, headline, content)
                                if analysis.get('impact_score', 0) >= 8:
                                    high_impact_items.append(item)
                            except Exception as llm_err:
                                poller_logger.error(f"LLM analysis failed: {llm_err}")

                        try:
                            await asyncio.to_thread(
                                persistence.save_article, url=url, headline=headline,
                                content=content, source=source_id, source_url=url,
                                published_at=published_at, symbols=symbols,
                                sentiment=analysis.get('sentiment') if analysis else None,
                                impact_score=analysis.get('impact_score') if analysis else None,
                                analysis=analysis,
                            )
                            saved_count += 1
                            from cache.redis_client import invalidate_news_cache
                            invalidate_news_cache()
                        except Exception as save_err:
                            poller_logger.error(f"Failed to save article: {save_err}")
                    except Exception as e:
                        poller_logger.error(f"Processing failed: {e}")

                if saved_count or skipped_count:
                    poller_logger.info(f"Source {source_id}: saved={saved_count}, skipped={skipped_count}")
                await news_ws_manager.broadcast({"type": "new_items", "source": source_id, "items": new_items})
                if high_impact_items:
                    await news_ws_manager.broadcast({"type": "high_impact_alert", "source": source_id, "items": high_impact_items})

                last_seen_ids[source_id] = current_top_id

            # Process all sources (fetched in parallel above, processed here)
            for source_id, items in results:
                await _process_source(source_id, items)

        except asyncio.CancelledError:
            poller_logger.info("News poller cancelled")
            break
        except Exception as e:
            poller_logger.error(f"Poller loop error: {e}")

        await asyncio.sleep(60)

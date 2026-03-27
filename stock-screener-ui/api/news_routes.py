"""
News API — WebSocket managers, background pollers, news endpoints, and WebSocket endpoints.
"""

import asyncio
import concurrent.futures
import logging
import os
import sys
from datetime import datetime
from pathlib import Path as PathlibPath
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Query, HTTPException, WebSocket, WebSocketDisconnect, Path

from api.screener import _sanitize_for_json

router = APIRouter(tags=["news"])


def _resolve(name):
    _main = sys.modules.get('api_server_fastapi')
    if _main is not None and hasattr(_main, name):
        val = getattr(_main, name)
        if val is not None:
            return val
    _news_mod = sys.modules.get('news_api')
    if _news_mod is not None and hasattr(_news_mod, name):
        val = getattr(_news_mod, name)
        if val is not None:
            return val
    return globals().get(name)


# -----
# News module imports (with graceful degradation)
# -----

_project_root = PathlibPath(__file__).resolve().parent.parent.parent
_news_module_path = _project_root / 'moneycontrol-scraper'
if str(_news_module_path) not in sys.path:
    sys.path.insert(0, str(_news_module_path))

try:
    from news_api import fetch_news, fetch_article_content, NEWS_SOURCES

    try:
        from llm_analyzer import article_analyzer
        _llm_available = True
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


# -----
# WebSocket Connection Managers
# -----

class NewsConnectionManager:
    def __init__(self):
        self.active_connections: set = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        print(f"📰 News WebSocket connected. Active connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        print(f"📰 News WebSocket disconnected. Active connections: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        disconnected = set()
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.add(connection)
        self.active_connections -= disconnected


class SectorConnectionManager:
    def __init__(self):
        self.active_connections: set = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        print(f"📊 Sector WebSocket connected. Active connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        print(f"📊 Sector WebSocket disconnected. Active connections: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        disconnected = set()
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.add(connection)
        self.active_connections -= disconnected


news_ws_manager = NewsConnectionManager()
sector_ws_manager = SectorConnectionManager()


# -----
# Sector poller + WebSocket
# -----

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
        except Exception as e:
            print(f"⚠️ Sector poller error: {e}")
            await asyncio.sleep(10)


@router.websocket("/ws/sector")
async def websocket_sector(websocket: WebSocket):
    await sector_ws_manager.connect(websocket)
    try:
        await websocket.send_json({
            "type": "connected",
            "message": "Connected to sector updates",
            "timestamp": datetime.now().isoformat()
        })
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        sector_ws_manager.disconnect(websocket)
    except Exception as e:
        print(f"📊 Sector WebSocket error: {e}")
        sector_ws_manager.disconnect(websocket)


# -----
# News prefetch + poller background tasks
# -----

def _do_prefetch_sync():
    from services.news_persistence import get_persistence_service

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

            for source_id in source_ids:
                try:
                    items = await asyncio.to_thread(fetch_news, source=source_id, limit=20)
                    if not items:
                        poller_logger.warning(f"No items returned from {source_id}")
                        continue

                    current_top_id = items[0].get('id')
                    last_id = last_seen_ids.get(source_id)

                    if last_id is None:
                        last_seen_ids[source_id] = current_top_id
                        poller_logger.info(f"Initialized tracking for {source_id}, top_id={current_top_id}")
                        continue

                    if current_top_id != last_id:
                        new_items = []
                        for item in items:
                            if item.get('id') == last_id:
                                break
                            new_items.append(item)

                        if new_items:
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
                                        poller_logger.warning(f"Skipping empty article: {headline[:60]} | error={full_article.get('error', 'no content')}")
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
                                            item['analysis'] = analysis

                                            if analysis.get('impact_score', 0) >= 8:
                                                high_impact_items.append(item)
                                        except Exception as llm_err:
                                            poller_logger.error(f"LLM analysis failed for {url}: {llm_err}")

                                    try:
                                        await asyncio.to_thread(
                                            persistence.save_article,
                                            url=url,
                                            headline=headline,
                                            content=content,
                                            source=source_id,
                                            source_url=url,
                                            published_at=published_at,
                                            symbols=symbols,
                                            sentiment=analysis.get('sentiment') if analysis else None,
                                            impact_score=analysis.get('impact_score') if analysis else None,
                                            analysis=analysis
                                        )
                                        saved_count += 1

                                        from cache.redis_client import cache_delete_pattern, is_cache_available
                                        if is_cache_available():
                                            cache_delete_pattern("news:all:*")
                                            cache_delete_pattern("news:recent:*")
                                            if analysis:
                                                for sym in symbols:
                                                    code = sym.get('code', '') if isinstance(sym, dict) else str(sym)
                                                    if code:
                                                        cache_delete_pattern(f"news:sentiment:{code.upper()}")
                                            poller_logger.debug("Invalidated news cache after saving article")
                                    except Exception as save_err:
                                        poller_logger.error(f"Failed to save article {url}: {save_err}")

                                except Exception as e:
                                    poller_logger.error(f"Processing failed for {item.get('id')}: {e}")

                            if saved_count > 0 or skipped_count > 0:
                                poller_logger.info(f"Source {source_id}: saved={saved_count}, skipped={skipped_count}")

                            await news_ws_manager.broadcast({
                                "type": "new_items",
                                "source": source_id,
                                "items": new_items,
                                "timestamp": datetime.now().isoformat()
                            })

                            if high_impact_items:
                                poller_logger.info(f"Broadcasting {len(high_impact_items)} high impact alerts from {source_id}")
                                await news_ws_manager.broadcast({
                                    "type": "high_impact_alert",
                                    "source": source_id,
                                    "items": high_impact_items,
                                    "timestamp": datetime.now().isoformat()
                                })

                        last_seen_ids[source_id] = current_top_id

                except Exception as e:
                    poller_logger.error(f"Error polling {source_id}: {e}")

                await asyncio.sleep(2)

        except Exception as e:
            poller_logger.error(f"Poller loop error: {e}")

        await asyncio.sleep(60)


# -----
# News REST endpoints
# -----

@router.get("/api/news")
async def get_news(
    source: str = Query(default=None, description="News source identifier (omit for all sources)"),
    limit: int = Query(default=25, ge=1, le=100, description="Max number of items")
):
    _news_available = _resolve('_news_available')
    fetch_news = _resolve('fetch_news')

    if not _news_available:
        raise HTTPException(status_code=503, detail="News API not available")

    try:
        if source and source != 'all':
            news = await asyncio.to_thread(fetch_news, source=source, limit=limit)
        else:
            from cache.redis_client import cache_get, cache_set, is_cache_available

            cache_key = f"news:all:recent:{limit}"
            cached = cache_get(cache_key) if is_cache_available() else None
            if cached is not None:
                return cached

            from services.news_persistence import get_persistence_service
            persistence = get_persistence_service()
            articles = await asyncio.to_thread(persistence.get_recent_articles, hours=48, limit=limit)
            news = []
            for a in articles:
                pub = a.get('published_at') or a.get('fetched_at') or ''
                news.append({
                    'id': a.get('id'),
                    'headline': a.get('headline', ''),
                    'description': a.get('content', ''),
                    'source': a.get('source', ''),
                    'sourceUrl': a.get('url', a.get('source_url', '')),
                    'publishedAt': pub,
                    'fetchedAt': a.get('fetched_at', ''),
                })

        result = {
            'items': news,
            'source': source or 'all',
            'total': len(news),
            'fetchedAt': datetime.now().isoformat()
        }

        if not source or source == 'all':
            from cache.redis_client import cache_set, is_cache_available
            if is_cache_available():
                cache_set(cache_key, result, ttl=60)

        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/news/sentiment/{symbol}")
async def get_symbol_sentiment(symbol: str = Path(..., description="Stock symbol to analyze")):
    _news_available = _resolve('_news_available')
    _llm_available = _resolve('_llm_available')
    article_analyzer = _resolve('article_analyzer')
    fetch_article_content = _resolve('fetch_article_content')

    if not _news_available or not _llm_available:
        raise HTTPException(status_code=503, detail="News/LLM API not available")

    from cache.redis_client import cache_get, cache_set, is_cache_available
    cache_key = f"news:sentiment:{symbol.upper()}"
    cached = cache_get(cache_key) if is_cache_available() else None
    if cached is not None:
        return cached

    try:
        news_api_mod = sys.modules.get('news_api')
        if news_api_mod is None:
            try:
                import news_api as news_api_mod
            except ImportError:
                news_api_mod = None

        _aggregator = getattr(news_api_mod, '_aggregator', None) if news_api_mod else None
        if _aggregator is None:
            raise HTTPException(status_code=503, detail="News API not available")

        all_news = await asyncio.to_thread(_aggregator.fetch_all, limit_per_source=15)

        relevant_articles = []
        for news_item in all_news:
            url = news_item.get('sourceUrl')

            article = await asyncio.to_thread(fetch_article_content, url)

            headline = article.get('headline', '')
            content = article.get('description', '')
            extracted_symbols = [s.get('code', '') for s in article.get('symbols', [])]

            if (symbol.upper() in headline.upper() or
                symbol.upper() in content.upper() or
                symbol.upper() in extracted_symbols):
                relevant_articles.append({
                    "url": url,
                    "headline": headline,
                    "content": content,
                    "publishedAt": article.get('publishedAt')
                })

            if len(relevant_articles) >= 5:
                break

        if not relevant_articles:
             return {
                 "symbol": symbol.upper(),
                 "status": "NO_RECENT_NEWS",
                 "sentiment_score": 0,
                 "sentiment_label": "NEUTRAL",
                 "articles_analyzed": 0,
                 "trade_ideas": []
             }

        total_impact = 0
        sentiment_math = 0
        all_trade_ideas = []
        analyzed_data = []

        for article in relevant_articles:
            analysis = await asyncio.to_thread(
                article_analyzer.analyze_article,
                article['url'], article['headline'], article['content']
            )

            imp = analysis.get('impact_score', 0)
            total_impact += imp

            sent = analysis.get('sentiment', 'NEUTRAL')
            if sent == "BULLISH": sentiment_math += imp
            elif sent == "BEARISH": sentiment_math -= imp

            for trade in analysis.get('trade_ideas', []):
                 if trade.get('symbol', '').upper() == symbol.upper() or symbol.upper() in trade.get('symbol', '').upper():
                     all_trade_ideas.append(trade)

            analyzed_data.append({
                "headline": article['headline'],
                "url": article['url'],
                "sentiment": sent,
                "impact": imp,
                "summary": analysis.get('summary', '')
            })

        max_possible_impact = len(relevant_articles) * 10
        raw_score = (sentiment_math / max_possible_impact) * 100 if max_possible_impact > 0 else 0

        if raw_score >= 30: label = "BULLISH"
        elif raw_score <= -30: label = "BEARISH"
        else: label = "NEUTRAL"

        result = {
             "symbol": symbol.upper(),
             "status": "SUCCESS",
             "sentiment_score": round(raw_score, 1),
             "sentiment_label": label,
             "articles_analyzed": len(relevant_articles),
             "trade_ideas": all_trade_ideas,
             "articles": analyzed_data
        }

        if is_cache_available():
            from cache.redis_client import cache_set_smart
            cache_set_smart(cache_key, result, full_ttl=300, skim_ttl=60)

        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/news/article")
async def get_news_article(url: str = Query(..., description="Article URL to fetch")):
    _news_available = _resolve('_news_available')
    _llm_available = _resolve('_llm_available')
    fetch_article_content = _resolve('fetch_article_content')
    article_analyzer = _resolve('article_analyzer')

    if not _news_available:
        raise HTTPException(status_code=503, detail="News API not available")

    from cache.redis_client import cache_get, cache_set
    import hashlib as _hashlib
    _article_cache_key = f"news:article:{_hashlib.md5(url.encode()).hexdigest()[:16]}"
    _cached_article = cache_get(_article_cache_key)
    if _cached_article is not None:
        _cached_article["from_cache"] = True
        return _cached_article

    try:
        article = await asyncio.to_thread(fetch_article_content, url)
        if 'error' in article:
            raise HTTPException(status_code=500, detail=article['error'])

        analysis_data = None
        sentiment = None
        impact_score = None
        symbols = article.get('symbols', [])

        headline = article.get('headline', '')
        content = article.get('description', '')

        if _llm_available and article_analyzer and content and len(content) > 100:
            try:
                print(f"🤖 Analyzing article via LLM: {headline[:50]}...")
                analysis_data = await asyncio.to_thread(article_analyzer.analyze_article, url, headline, content)

                sentiment = analysis_data.get('sentiment')
                impact_score = analysis_data.get('impact_score')

                if not symbols:
                    key_entities = analysis_data.get('key_entities', [])
                    if key_entities:
                        symbols = [{'code': entity, 'name': entity} for entity in key_entities]
                        print(f"📊 LLM extracted {len(key_entities)} entities: {key_entities}")

            except Exception as e:
                print(f"⚠️ LLM analysis failed: {e}")

        try:
            from services.news_persistence import get_persistence_service
            from services.news_instrument_mapper import get_mapper

            persistence = get_persistence_service()
            mapper = get_mapper()

            published_at = None
            if article.get('publishedAt'):
                try:
                    published_at = datetime.fromisoformat(article['publishedAt'].replace('Z', '+00:00'))
                except Exception:
                    pass

            enriched_symbols = mapper.map_symbols(symbols)

            saved_article = await asyncio.to_thread(
                persistence.save_article,
                url=url,
                headline=headline,
                content=content,
                source=article.get('source', 'unknown'),
                source_url=url,
                published_at=published_at,
                symbols=enriched_symbols,
                sentiment=sentiment,
                impact_score=impact_score,
                analysis=analysis_data
            )

            article['id'] = saved_article.id
            article['symbols'] = enriched_symbols
            article['sentiment'] = sentiment
            article['impact_score'] = impact_score
            if analysis_data:
                article['summary'] = analysis_data.get('summary')
                article['key_points'] = analysis_data.get('key_points')
                article['key_entities'] = analysis_data.get('key_entities')
                article['trade_ideas'] = analysis_data.get('trade_ideas')

        except Exception as persist_error:
            print(f"⚠️ Could not persist article: {persist_error}")

        from cache.redis_client import cache_set_smart
        cache_set_smart(_article_cache_key, article, full_ttl=86400, skim_ttl=300)
        return article
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/news/analyze")
async def analyze_news(url: str = Query(..., description="URL of the news article to analyze")):
    _news_available = _resolve('_news_available')
    _llm_available = _resolve('_llm_available')
    fetch_article_content = _resolve('fetch_article_content')
    article_analyzer = _resolve('article_analyzer')

    if not _news_available or not _llm_available:
        raise HTTPException(status_code=503, detail="News/LLM API not available")

    from cache.redis_client import cache_get, cache_set, is_cache_available
    import hashlib
    cache_key = f"news:llm:{hashlib.md5(url.encode()).hexdigest()[:16]}"
    cached = cache_get(cache_key) if is_cache_available() else None
    if cached is not None:
        return cached

    try:
        article_data = await asyncio.to_thread(fetch_article_content, url)

        if 'error' in article_data:
             raise HTTPException(status_code=500, detail=article_data['error'])

        headline = article_data.get('headline', '')
        content = article_data.get('description', '')

        analysis = await asyncio.to_thread(article_analyzer.analyze_article, url, headline, content)

        result = {
            "url": url,
            "headline": headline,
            "content_preview": content[:200] + "..." if len(content) > 200 else content,
            "analysis": analysis
        }

        if is_cache_available():
            from cache.redis_client import cache_set_smart
            cache_set_smart(cache_key, result, full_ttl=86400, skim_ttl=300)

        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/news/sources")
async def get_news_sources():
    _news_available = _resolve('_news_available')
    NEWS_SOURCES = _resolve('NEWS_SOURCES')

    if not _news_available:
        return {'sources': []}

    return {'sources': NEWS_SOURCES}


# -----
# News WebSocket
# -----

@router.websocket("/ws/news")
async def websocket_news(websocket: WebSocket):
    await news_ws_manager.connect(websocket)
    try:
        await websocket.send_json({
            "type": "connected",
            "message": "Connected to news updates",
            "timestamp": datetime.now().isoformat()
        })

        while True:
            data = await websocket.receive_text()

    except WebSocketDisconnect:
        news_ws_manager.disconnect(websocket)
    except Exception as e:
        print(f"📰 WebSocket error: {e}")
        news_ws_manager.disconnect(websocket)

"""
News fetching endpoints: scrape articles and poll for updates.
"""

import asyncio
import hashlib as _hashlib
import sys
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query

from api.news.news_poller import _get_module_vars

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


@router.get("/api/news/article")
async def get_news_article(url: str = Query(..., description="Article URL to fetch")):
    _news_available = _resolve('_news_available')
    _llm_available = _resolve('_llm_available')
    fetch_article_content = _resolve('fetch_article_content')
    article_analyzer = _resolve('article_analyzer')

    if not _news_available:
        raise HTTPException(status_code=503, detail="News API not available")

    from cache.redis_client import cache_get, cache_set
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

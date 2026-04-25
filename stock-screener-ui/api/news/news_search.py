"""
Search and filter endpoints for news articles.
"""

import asyncio
import sys
from datetime import datetime

from fastapi import APIRouter, HTTPException, Path, Query

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

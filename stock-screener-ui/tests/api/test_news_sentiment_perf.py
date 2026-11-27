"""Regression: /api/news/sentiment must not serialize one HTTP scrape per feed item.

The endpoint fetches a page of headlines (1 feed fetch) and used to scrape each
one sequentially before filtering by symbol — N extra round-trips per request.
Scrapes are now fanned out in bounded, ordered batches.
"""

import asyncio
import sys
import threading
import time
from unittest.mock import MagicMock, patch

import pytest

from api.news import news_search

pytestmark = pytest.mark.asyncio


async def test_sentiment_scrapes_overlap_and_keep_source_order():
    feed = [{"sourceUrl": f"http://feed/{i}", "headline": f"Story {i}"} for i in range(8)]
    scraped = {
        f"http://feed/{i}": {
            "headline": "ACME jumps" if i in (1, 5) else f"Other story {i}",
            "description": "body",
            "publishedAt": f"2026-01-{i + 1:02d}",
            "symbols": [],
        }
        for i in range(8)
    }

    state = {"active": 0, "peak": 0, "calls": 0}
    lock = threading.Lock()

    def fake_fetch(url):
        with lock:
            state["active"] += 1
            state["calls"] += 1
            state["peak"] = max(state["peak"], state["active"])
        try:
            time.sleep(0.05)
            return scraped[url]
        finally:
            with lock:
                state["active"] -= 1

    analyzed = []

    def fake_analyze(url, headline, content):
        analyzed.append(url)
        return {"impact_score": 5, "sentiment": "BULLISH", "trade_ideas": []}

    values = {
        "_news_available": True,
        "_llm_available": True,
        "article_analyzer": MagicMock(analyze_article=fake_analyze),
        "fetch_article_content": fake_fetch,
    }
    stub = MagicMock()
    stub._aggregator.fetch_all = MagicMock(return_value=feed)

    with patch.object(news_search, "_resolve", side_effect=lambda name: values.get(name)), \
         patch.dict(sys.modules, {"news_api": stub}), \
         patch("cache.redis_client.cache_get", return_value=None), \
         patch("cache.redis_client.is_cache_available", return_value=False):
        result = await news_search.get_symbol_sentiment("ACME")

    assert state["calls"] == len(feed)          # no duplicate feed/article fetches
    assert state["peak"] > 1                    # scrapes actually overlapped
    assert state["peak"] <= news_search._SENTIMENT_SCRAPE_BATCH  # still bounded
    assert analyzed == ["http://feed/1", "http://feed/5"]  # source order preserved
    assert result["articles_analyzed"] == 2

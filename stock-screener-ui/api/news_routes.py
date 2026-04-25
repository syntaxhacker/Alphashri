"""
News API — backward-compatible wrapper.

All implementation lives in ``api.news`` sub-package.
This file re-exports the combined router and functions.
"""

from api.news import router
from api.news.news_poller import (
    news_startup_prefetch,
    news_poller_task,
    sector_poller_task,
    _init_news_modules,
)
from api.news.news_ws import (
    NewsConnectionManager,
    SectorConnectionManager,
    news_ws_manager,
    sector_ws_manager,
)

_news_available = False
_llm_available = False
fetch_news = None
fetch_article_content = None
NEWS_SOURCES = []
article_analyzer = None

try:
    _news_available, _llm_available, article_analyzer, fetch_news, fetch_article_content, NEWS_SOURCES = _init_news_modules()
except Exception:
    pass

__all__ = [
    "router",
    "news_startup_prefetch",
    "news_poller_task",
    "sector_poller_task",
    "NewsConnectionManager",
    "SectorConnectionManager",
    "news_ws_manager",
    "sector_ws_manager",
    "_news_available",
    "_llm_available",
    "fetch_news",
    "fetch_article_content",
    "NEWS_SOURCES",
    "article_analyzer",
]

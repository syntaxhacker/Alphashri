"""
News API — WebSocket managers, background pollers, news endpoints, and WebSocket endpoints.

This module re-exports the combined router from api.news for backward compatibility.
All implementation lives in the ``api.news`` sub-package.
"""

from api.news.news_crud import router as _crud_router
from api.news.news_fetch import router as _fetch_router
from api.news.news_search import router as _search_router
from api.news.news_ws import router as _ws_router
from api.news.news_poller import (
    news_startup_prefetch,
    news_poller_task,
    sector_poller_task,
)

from fastapi import APIRouter

router = APIRouter(tags=["news"])
router.include_router(_fetch_router)
router.include_router(_search_router)
router.include_router(_crud_router)
router.include_router(_ws_router)

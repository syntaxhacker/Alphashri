#!/usr/bin/env python3
"""
News Sentiment Analyzer - Early Signal Detection
Beat the volume spike by catching news 10-15 minutes early
"""

from upstox_trader.analyzers.news.sentiment_models import (
    POSITIVE_KEYWORDS,
    NEGATIVE_KEYWORDS,
    HIGH_IMPACT_KEYWORDS,
    NEWS_SOURCES,
    SentimentResult,
    VolumePrediction,
    NewsItem,
    TradingAlert,
)

from upstox_trader.analyzers.news.sentiment_analyzer import (
    NewsSentimentAnalyzer,
    NewsAnalyzer,
)

from upstox_trader.analyzers.news.sentiment_api import (
    get_tv_cookies,
    get_headers,
    scrape_moneycontrol_news,
    scrape_google_news,
    search_web_news,
    parse_relative_time,
)

from upstox_trader.analyzers.news.sentiment_utils import (
    load_nse_stocks,
    setup_news_logging,
    save_news_to_csv,
    save_scan_summary,
    parallel_news_scan,
    run_watch_mode,
)

__all__ = [
    'POSITIVE_KEYWORDS',
    'NEGATIVE_KEYWORDS',
    'HIGH_IMPACT_KEYWORDS',
    'NEWS_SOURCES',
    'SentimentResult',
    'VolumePrediction',
    'NewsItem',
    'TradingAlert',
    'NewsSentimentAnalyzer',
    'NewsAnalyzer',
    'get_tv_cookies',
    'get_headers',
    'scrape_moneycontrol_news',
    'scrape_google_news',
    'search_web_news',
    'parse_relative_time',
    'load_nse_stocks',
    'setup_news_logging',
    'save_news_to_csv',
    'save_scan_summary',
    'parallel_news_scan',
    'run_watch_mode',
]

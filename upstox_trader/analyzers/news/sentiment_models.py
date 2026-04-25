#!/usr/bin/env python3
"""
Sentiment Models - Data classes and models for sentiment analysis
"""

from dataclasses import dataclass
from typing import List, Optional
from datetime import datetime


POSITIVE_KEYWORDS = [
    'win', 'won', 'award', 'contract', 'order', 'growth', 'expansion', 'profit',
    'beat', 'strong', 'bullish', 'acquisition', 'merger', 'approval', 'launch',
    'breakthrough', 'success', 'milestone', 'boost', 'surge', 'rally', 'upgrade',
    'outperform', 'exceed', 'record', 'highest', 'best', 'positive', 'optimistic'
]

NEGATIVE_KEYWORDS = [
    'loss', 'decline', 'weak', 'concern', 'issue', 'delay', 'cancel', 'postpone',
    'warning', 'bearish', 'downgrade', 'sell', 'avoid', 'risk', 'threat', 'fall',
    'drop', 'crash', 'plunge', 'worst', 'negative', 'pessimistic', 'cut', 'reduce'
]

HIGH_IMPACT_KEYWORDS = [
    'crore', 'billion', 'merger', 'acquisition', 'ipo', 'results', 'earnings',
    'government contract', 'tender', 'policy', 'regulation', 'ban', 'approval',
    'order win', 'contract win', 'project award', 'order book', 'revenue',
    'bagged', 'won', 'midc', 'zld', 'effluent', 'treatment', 'infrastructure'
]

NEWS_SOURCES = {
    'moneycontrol': {
        'url_template': 'https://www.moneycontrol.com/news/tags/{symbol}.html',
        'priority': 1,
        'reliability': 0.8
    },
    'economictimes': {
        'url_template': 'https://economictimes.indiatimes.com/topic/{symbol}',
        'priority': 2,
        'reliability': 0.9
    },
    'business_standard': {
        'url_template': 'https://www.business-standard.com/topic/{symbol}',
        'priority': 3,
        'reliability': 0.7
    }
}


@dataclass
class SentimentResult:
    sentiment_score: float
    positive_keywords: int
    negative_keywords: int
    impact_multiplier: float
    time_weight: float
    confidence: float
    financial_impact: bool
    detected_amounts: List


@dataclass
class VolumePrediction:
    prediction: str
    probability: float
    impact_score: float
    sentiment_direction: str


@dataclass
class NewsItem:
    source: str
    symbol: str
    headline: str
    link: str
    timestamp: datetime
    content: str
    id: str
    sentiment_analysis: Optional[SentimentResult] = None
    volume_prediction: Optional[VolumePrediction] = None


@dataclass
class TradingAlert:
    symbol: str
    timestamp: datetime
    alert_type: str
    headline: str
    source: str
    sentiment_score: float
    confidence: float
    volume_prediction: str
    probability: float
    direction: str
    urgency: str
    action: str

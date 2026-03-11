"""
Tests for News API and Scrapers.

Test cases cover:
- ID Generation and Date Parsing
- Aggregator concurrent fetching
- Symbol grouping logic
"""
import sys
from pathlib import Path
from datetime import datetime
import pytest
from unittest.mock import MagicMock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'moneycontrol-scraper'))

# MOCK SCRAPLING TO PREVENT GLOBAL IMPORT ERRORS
sys.modules['scrapling'] = MagicMock()
sys.modules['scrapling.fetchers'] = MagicMock()

from news_api import (
    BaseNewsScraper,
    NewsAggregator,
    fetch_news,
    fetch_article_content
)

class DummyScraper(BaseNewsScraper):
    source_id = "dummy"
    source_name = "Dummy News"
    base_url = "https://dummy.com"

    def fetch_latest_news(self, limit=5):
        return [
            {
                'id': self._generate_id('http://dummy.com/1'),
                'headline': 'Dummy Headline 1',
                'description': '',
                'source': self.source_id,
                'sourceUrl': 'http://dummy.com/1',
                'publishedAt': datetime.now().isoformat(),
                'fetchedAt': datetime.now().isoformat()
            }
        ]

    def fetch_article_content(self, url):
        return {
             'id': self._generate_id(url),
             'headline': 'Dummy Headline 1',
             'description': 'Dummy Content',
             'source': self.source_id,
             'sourceUrl': url,
             'publishedAt': datetime.now().isoformat(),
             'fetchedAt': datetime.now().isoformat(),
             'symbols': [{'name': 'Tata', 'code': 'TATA', 'url': 'http://tata'}]
        }

class TestBaseNewsScraper:
    def setup_method(self):
        self.scraper = BaseNewsScraper()

    def test_generate_id(self):
        id1 = self.scraper._generate_id("https://example.com/1")
        id2 = self.scraper._generate_id("https://example.com/2")
        assert len(id1) == 12
        assert id1 != id2
        assert self.scraper._generate_id("https://example.com/1") == id1

    def test_parse_date_generic(self):
        # Test various date formats
        d1 = self.scraper._parse_date_generic("February 26, 2026 22:06")
        assert d1 is not None and d1.year == 2026
        
        d2 = self.scraper._parse_date_generic("first published: 26 Feb 2026")
        assert d2 is not None and d2.year == 2026
        
        d3 = self.scraper._parse_date_generic("INVALID DATE STRING")
        assert d3 is None

class TestNewsAggregator:
    def setup_method(self):
        self.aggregator = NewsAggregator()
        # Override scrapers with dummy for isolated testing
        self.aggregator.scrapers = {'dummy': DummyScraper()}

    def test_fetch_from_source(self):
        news = self.aggregator.fetch_from_source('dummy', 5)
        assert len(news) == 1
        assert news[0]['source'] == 'dummy'
        assert news[0]['headline'] == 'Dummy Headline 1'

    def test_group_news_by_symbol(self):
        # Create mock enriched articles containing symbols
        mock_articles = [
            {
                'id': '1', 'headline': 'Tata News', 'source': 'dummy', 'sourceUrl': 'url1',
                'publishedAt': '2026-01-01T10:00:00',
                'symbols': [{'code': 'TATAMOTORS'}]
            },
            {
                'id': '2', 'headline': 'Reliance News', 'source': 'dummy', 'sourceUrl': 'url2',
                'publishedAt': '2026-01-02T10:00:00',
                'symbols': [{'code': 'RELIANCE'}]
            },
            {
                'id': '3', 'headline': 'Tata & Reliance', 'source': 'dummy', 'sourceUrl': 'url3',
                'publishedAt': '2026-01-03T10:00:00',
                'symbols': [{'code': 'TATAMOTORS'}, {'code': 'RELIANCE'}]
            }
        ]
        
        grouped = self.aggregator.group_news_by_symbol(mock_articles)
        
        assert 'TATAMOTORS' in grouped
        assert 'RELIANCE' in grouped
        assert len(grouped['TATAMOTORS']) == 2
        assert len(grouped['RELIANCE']) == 2
        
        # Verify sorting (newest first)
        assert grouped['TATAMOTORS'][0]['id'] == '3'
        assert grouped['TATAMOTORS'][1]['id'] == '1'

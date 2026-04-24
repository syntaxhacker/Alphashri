"""
Tests for NewsPersistenceService.
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import Mock, patch, MagicMock
import tempfile
import os

from services.news_persistence import (
    NewsPersistenceService,
    get_persistence_service,
)
from db.models import NewsArticle, NewsSymbolMention


@pytest.fixture
def mock_db_session():
    """Create a mock database session."""
    session = MagicMock()
    return session


@pytest.fixture
def mock_mapper():
    """Create a mock instrument mapper."""
    mapper = MagicMock()
    mapper.map_symbols.return_value = [
        {
            'code': 'RELIANCE',
            'trading_symbol': 'RELIANCE',
            'instrument_key': 'NSE_EQ|INE002A01018',
            'company_name': 'Reliance Industries Ltd',
            'match_confidence': 1.0,
            'match_method': 'exact'
        },
        {
            'code': 'TCS',
            'trading_symbol': 'TCS',
            'instrument_key': 'NSE_EQ|INE467B01029',
            'company_name': 'TCS Ltd',
            'match_confidence': 1.0,
            'match_method': 'exact'
        },
        {
            'code': 'UNKNOWN',
            'trading_symbol': None,
            'instrument_key': None,
            'company_name': None,
            'match_confidence': 0.0,
            'match_method': 'none'
        }
    ]
    mapper.get_stats.return_value = {
        'total_instruments': 100,
        'eq_instruments': 50,
        'company_names_indexed': 50,
        'fuzzy_threshold': 0.8,
        'known_variations': 10
    }
    return mapper


@pytest.fixture
def persistence_service(mock_mapper):
    """Create persistence service with mocked dependencies."""
    with patch('services.news_persistence.get_mapper', return_value=mock_mapper):
        with patch('services.news_persistence.SessionLocal') as mock_session:
            service = NewsPersistenceService()
            service.mapper = mock_mapper
            yield service


class TestNewsPersistenceService:
    def test_save_article_new(self, persistence_service, mock_mapper):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        
        mock_article = MagicMock()
        mock_article.id = 1
        mock_db.add.return_value = None
        mock_db.flush.return_value = None
        
        with patch('services.news_persistence.SessionLocal', return_value=mock_db):
            result = persistence_service.save_article(
                url='https://example.com/article/1',
                headline='Test Article',
                content='Test content',
                source='moneycontrol',
                symbols=[
                    {'code': 'RELIANCE', 'name': 'Reliance'},
                    {'code': 'TCS', 'name': 'TCS'}
                ]
            )
            
            mock_db.add.assert_called()
            mock_db.commit.assert_called()
    
    def test_save_article_existing(self, persistence_service):
        mock_db = MagicMock()
        existing_article = MagicMock()
        existing_article.id = 1
        mock_db.query.return_value.filter.return_value.first.return_value = existing_article
        
        with patch('services.news_persistence.SessionLocal', return_value=mock_db):
            result = persistence_service.save_article(
                url='https://example.com/article/1',
                headline='Test Article',
                content='Test content',
                source='moneycontrol'
            )
            
            mock_db.add.assert_not_called()
    
    def test_get_article_by_url(self, persistence_service):
        mock_db = MagicMock()
        mock_article = MagicMock()
        mock_article.to_dict.return_value = {
            'id': 1,
            'url': 'https://example.com/article/1',
            'headline': 'Test'
        }
        mock_db.query.return_value.filter.return_value.first.return_value = mock_article
        
        with patch('services.news_persistence.SessionLocal', return_value=mock_db):
            result = persistence_service.get_article_by_url('https://example.com/article/1')
            
            assert result is not None
            assert result['url'] == 'https://example.com/article/1'
    
    def test_get_article_by_url_not_found(self, persistence_service):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        
        with patch('services.news_persistence.SessionLocal', return_value=mock_db):
            result = persistence_service.get_article_by_url('https://example.com/notfound')
            
            assert result is None
    
    def test_get_articles_for_instrument(self, persistence_service):
        mock_db = MagicMock()
        
        mock_mentions = [
            MagicMock(article_id=1),
            MagicMock(article_id=2)
        ]
        mock_db.query.return_value.filter.return_value.order_by.return_value.offset.return_value.limit.return_value.all.return_value = mock_mentions
        
        mock_articles = [
            MagicMock(to_dict=lambda: {'id': 1, 'headline': 'Article 1'}),
            MagicMock(to_dict=lambda: {'id': 2, 'headline': 'Article 2'})
        ]
        mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = mock_articles
        
        with patch('services.news_persistence.SessionLocal', return_value=mock_db):
            result = persistence_service.get_articles_for_instrument('NSE_EQ|INE002A01018')
            
            assert len(result) == 2
    
    def test_get_articles_for_instrument_no_results(self, persistence_service):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.order_by.return_value.offset.return_value.limit.return_value.all.return_value = []
        
        with patch('services.news_persistence.SessionLocal', return_value=mock_db):
            result = persistence_service.get_articles_for_instrument('NSE_EQ|UNKNOWN')
            
            assert result == []
    
    def test_get_articles_for_symbol(self, persistence_service):
        mock_db = MagicMock()
        
        mock_mentions = [MagicMock(article_id=1)]
        mock_db.query.return_value.filter.return_value.order_by.return_value.offset.return_value.limit.return_value.all.return_value = mock_mentions
        
        mock_articles = [
            MagicMock(to_dict=lambda: {'id': 1, 'headline': 'RELIANCE Article'})
        ]
        mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = mock_articles
        
        with patch('services.news_persistence.SessionLocal', return_value=mock_db):
            result = persistence_service.get_articles_for_symbol('RELIANCE')
            
            assert len(result) == 1
    
    def test_get_recent_articles(self, persistence_service):
        mock_db = MagicMock()
        
        mock_articles = [
            MagicMock(to_dict=lambda: {'id': 1, 'headline': 'Recent Article 1'}),
            MagicMock(to_dict=lambda: {'id': 2, 'headline': 'Recent Article 2'})
        ]
        mock_db.query.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = mock_articles
        
        with patch('services.news_persistence.SessionLocal', return_value=mock_db):
            result = persistence_service.get_recent_articles(hours=24)
            
            assert len(result) == 2
    
    def test_get_recent_articles_with_source(self, persistence_service):
        mock_db = MagicMock()
        
        mock_articles = [
            MagicMock(to_dict=lambda: {'id': 1, 'source': 'moneycontrol'})
        ]
        mock_db.query.return_value.filter.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = mock_articles
        
        with patch('services.news_persistence.SessionLocal', return_value=mock_db):
            result = persistence_service.get_recent_articles(hours=24, source='moneycontrol')
            
            assert len(result) == 1
    
    def test_get_symbols_for_article(self, persistence_service):
        mock_db = MagicMock()
        
        mock_mentions = [
            MagicMock(to_dict=lambda: {'symbol_code': 'RELIANCE', 'trading_symbol': 'RELIANCE'}),
            MagicMock(to_dict=lambda: {'symbol_code': 'TCS', 'trading_symbol': 'TCS'})
        ]
        mock_db.query.return_value.filter.return_value.all.return_value = mock_mentions
        
        with patch('services.news_persistence.SessionLocal', return_value=mock_db):
            result = persistence_service.get_symbols_for_article(article_id=1)
            
            assert len(result) == 2
    
    def test_get_mapped_symbols_for_article(self, persistence_service):
        mock_db = MagicMock()
        
        mock_mention = MagicMock()
        mock_mention.to_dict.return_value = {'symbol_code': 'RELIANCE', 'instrument_key': 'NSE_EQ|INE002A01018'}
        
        mock_query = MagicMock()
        mock_filter = MagicMock()
        mock_filter.all.return_value = [mock_mention]
        mock_query.filter.return_value = mock_filter
        mock_db.query.return_value = mock_query
        
        with patch('services.news_persistence.SessionLocal', return_value=mock_db):
            result = persistence_service.get_mapped_symbols_for_article(article_id=1)
            
            assert len(result) == 1
    
    def test_search_articles(self, persistence_service):
        mock_db = MagicMock()
        
        mock_articles = [
            MagicMock(to_dict=lambda: {'id': 1, 'headline': 'Reliance Q3 Results'})
        ]
        mock_db.query.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = mock_articles
        
        with patch('services.news_persistence.SessionLocal', return_value=mock_db):
            result = persistence_service.search_articles(query='Reliance')
            
            assert len(result) == 1
    
    def test_get_article_stats(self, persistence_service, mock_mapper):
        mock_db = MagicMock()
        
        mock_db.query.return_value.count.return_value = 10
        mock_db.query.return_value.filter.return_value.count.return_value = 5
        mock_db.query.return_value.filter.return_value = mock_db.query.return_value.filter
        mock_db.query.return_value.distinct.return_value.all.return_value = [('moneycontrol',), ('economictimes',)]
        
        with patch('services.news_persistence.SessionLocal', return_value=mock_db):
            result = persistence_service.get_article_stats()
            
            assert 'total_articles' in result
            assert 'total_symbol_mentions' in result
            assert 'mapped_symbols' in result
            assert 'mapper_stats' in result
    
    def test_cleanup_old_articles(self, persistence_service):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.delete.return_value = 5
        
        with patch('services.news_persistence.SessionLocal', return_value=mock_db):
            result = persistence_service.cleanup_old_articles(days=30)
            
            assert result == 5
            mock_db.commit.assert_called()


class TestGlobalFunctions:
    def test_get_persistence_service_singleton(self):
        with patch('services.news_persistence.get_mapper'):
            with patch('services.news_persistence.SessionLocal'):
                s1 = get_persistence_service()
                s2 = get_persistence_service()
                
                assert s1 is s2


class TestIntegrationWithMapper:
    def test_symbols_are_mapped_on_save(self, mock_mapper):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        
        mock_article = MagicMock()
        mock_article.id = 1
        
        article_instances = []
        def capture_article(article):
            article_instances.append(article)
            return None
        
        mock_db.add.side_effect = capture_article
        
        with patch('services.news_persistence.SessionLocal', return_value=mock_db):
            with patch('services.news_persistence.get_mapper', return_value=mock_mapper):
                service = NewsPersistenceService()
                result = service.save_article(
                    url='https://example.com/test',
                    headline='Test',
                    content='Content',
                    source='test',
                    symbols=[
                        {'code': 'RELIANCE', 'name': 'Reliance'},
                        {'code': 'TCS', 'name': 'TCS'}
                    ]
                )
                
                mock_mapper.map_symbols.assert_called_once()

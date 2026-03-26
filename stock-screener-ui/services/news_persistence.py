"""
News Persistence Service
========================

Handles saving and retrieving news articles from the database,
with automatic symbol-to-instrument mapping.
"""

import json
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from db.database import SessionLocal
from db.models import NewsArticle, NewsSymbolMention
from services.news_instrument_mapper import get_mapper, MappingResult


class NewsPersistenceService:
    """Service for persisting and retrieving news articles."""
    
    def __init__(self):
        self.mapper = get_mapper()
    
    def save_article(
        self,
        url: str,
        headline: str,
        content: str,
        source: str,
        source_url: Optional[str] = None,
        published_at: Optional[datetime] = None,
        symbols: Optional[List[Dict]] = None,
        sentiment: Optional[str] = None,
        impact_score: Optional[int] = None,
        analysis: Optional[Dict] = None
    ) -> NewsArticle:
        """Save a news article with its symbol mentions."""
        db = SessionLocal()
        try:
            existing = db.query(NewsArticle).filter(NewsArticle.url == url).first()
            if existing:
                return existing
            
            article = NewsArticle(
                url=url,
                headline=headline,
                content=content,
                source=source,
                source_url=source_url,
                published_at=published_at,
                sentiment=sentiment,
                impact_score=impact_score,
                analysis_json=json.dumps(analysis) if analysis else None
            )
            db.add(article)
            db.flush()
            
            if symbols:
                self._save_symbols(db, article.id, symbols)
            
            db.commit()
            db.refresh(article)
            return article
            
        except Exception as e:
            db.rollback()
            raise e
        finally:
            db.close()
    
    def _save_symbols(self, db, article_id: int, symbols: List[Dict]):
        """Save symbol mentions with instrument mapping."""
        mapped_symbols = self.mapper.map_symbols(symbols)
        
        for sym in mapped_symbols:
            mention = NewsSymbolMention(
                article_id=article_id,
                symbol_code=sym.get('code', ''),
                trading_symbol=sym.get('trading_symbol'),
                instrument_key=sym.get('instrument_key'),
                company_name=sym.get('company_name'),
                match_confidence=sym.get('match_confidence'),
                match_method=sym.get('match_method')
            )
            db.add(mention)
    
    def get_article_by_url(self, url: str) -> Optional[Dict]:
        """Get article by URL."""
        db = SessionLocal()
        try:
            article = db.query(NewsArticle).filter(NewsArticle.url == url).first()
            return article.to_dict() if article else None
        finally:
            db.close()
    
    def get_article_by_id(self, article_id: int) -> Optional[Dict]:
        """Get article by ID."""
        db = SessionLocal()
        try:
            article = db.query(NewsArticle).filter(NewsArticle.id == article_id).first()
            return article.to_dict() if article else None
        finally:
            db.close()
    
    def get_articles_for_instrument(
        self,
        instrument_key: str,
        limit: int = 10,
        offset: int = 0
    ) -> List[Dict]:
        """Get all articles mentioning a specific instrument."""
        db = SessionLocal()
        try:
            mentions = db.query(NewsSymbolMention).filter(
                NewsSymbolMention.instrument_key == instrument_key
            ).order_by(NewsSymbolMention.article_id.desc()).offset(offset).limit(limit).all()
            
            article_ids = [m.article_id for m in mentions]
            if not article_ids:
                return []
            
            articles = db.query(NewsArticle).filter(
                NewsArticle.id.in_(article_ids)
            ).order_by(NewsArticle.published_at.desc().nullslast()).all()
            
            return [a.to_dict() for a in articles]
        finally:
            db.close()
    
    def get_articles_for_symbol(
        self,
        symbol: str,
        limit: int = 10,
        offset: int = 0
    ) -> List[Dict]:
        """Get articles mentioning a symbol (by trading_symbol or code)."""
        db = SessionLocal()
        try:
            symbol_upper = symbol.upper()
            mentions = db.query(NewsSymbolMention).filter(
                (NewsSymbolMention.trading_symbol == symbol_upper) |
                (NewsSymbolMention.symbol_code == symbol_upper)
            ).order_by(NewsSymbolMention.article_id.desc()).offset(offset).limit(limit).all()
            
            article_ids = list(set(m.article_id for m in mentions))
            if not article_ids:
                return []
            
            articles = db.query(NewsArticle).filter(
                NewsArticle.id.in_(article_ids)
            ).order_by(NewsArticle.published_at.desc().nullslast()).all()
            
            return [a.to_dict() for a in articles]
        finally:
            db.close()
    
    def get_recent_articles(
        self,
        hours: int = 24,
        source: Optional[str] = None,
        limit: int = 50
    ) -> List[Dict]:
        """Get recent articles within specified hours, sorted by publish date."""
        db = SessionLocal()
        try:
            since = datetime.utcnow() - timedelta(hours=hours)
            query = db.query(NewsArticle).filter(NewsArticle.fetched_at >= since)
            
            if source:
                query = query.filter(NewsArticle.source == source)
            
            # Sort by published_at (newest first), fallback to fetched_at
            from sqlalchemy import case
            query = query.order_by(
                case(
                    (NewsArticle.published_at.is_(None), NewsArticle.fetched_at),
                    else_=NewsArticle.published_at
                ).desc()
            ).limit(limit)
            
            articles = query.all()
            return [a.to_dict() for a in articles]
        finally:
            db.close()
    
    def get_symbols_for_article(self, article_id: int) -> List[Dict]:
        """Get all symbol mentions for an article."""
        db = SessionLocal()
        try:
            mentions = db.query(NewsSymbolMention).filter(
                NewsSymbolMention.article_id == article_id
            ).all()
            return [m.to_dict() for m in mentions]
        finally:
            db.close()
    
    def get_mapped_symbols_for_article(self, article_id: int) -> List[Dict]:
        """Get symbol mentions that have valid instrument keys."""
        db = SessionLocal()
        try:
            mentions = db.query(NewsSymbolMention).filter(
                NewsSymbolMention.article_id == article_id,
                NewsSymbolMention.instrument_key.isnot(None)
            ).all()
            return [m.to_dict() for m in mentions]
        finally:
            db.close()
    
    def search_articles(
        self,
        query: str,
        limit: int = 20
    ) -> List[Dict]:
        """Search articles by headline or content."""
        db = SessionLocal()
        try:
            articles = db.query(NewsArticle).filter(
                (NewsArticle.headline.ilike(f'%{query}%')) |
                (NewsArticle.content.ilike(f'%{query}%'))
            ).order_by(
                NewsArticle.published_at.desc().nullslast()
            ).limit(limit).all()
            
            return [a.to_dict() for a in articles]
        finally:
            db.close()
    
    def get_article_stats(self) -> Dict[str, Any]:
        """Get statistics about stored articles."""
        db = SessionLocal()
        try:
            total_articles = db.query(NewsArticle).count()
            total_mentions = db.query(NewsSymbolMention).count()
            mapped_mentions = db.query(NewsSymbolMention).filter(
                NewsSymbolMention.instrument_key.isnot(None)
            ).count()
            
            sources = db.query(NewsArticle.source).distinct().all()
            sources = [s[0] for s in sources if s[0]]
            
            return {
                'total_articles': total_articles,
                'total_symbol_mentions': total_mentions,
                'mapped_symbols': mapped_mentions,
                'unmapped_symbols': total_mentions - mapped_mentions,
                'sources': sources,
                'mapper_stats': self.mapper.get_stats()
            }
        finally:
            db.close()
    
    def cleanup_old_articles(self, days: int = 30) -> int:
        """Remove articles older than specified days."""
        db = SessionLocal()
        try:
            cutoff = datetime.utcnow() - timedelta(days=days)
            articles = db.query(NewsArticle).filter(
                NewsArticle.fetched_at < cutoff
            ).all()
            deleted = len(articles)
            for article in articles:
                db.delete(article)
            db.commit()
            return deleted
        except Exception as e:
            db.rollback()
            raise e
        finally:
            db.close()


_persistence_instance: Optional[NewsPersistenceService] = None


def get_persistence_service() -> NewsPersistenceService:
    """Get singleton persistence service instance."""
    global _persistence_instance
    if _persistence_instance is None:
        _persistence_instance = NewsPersistenceService()
    return _persistence_instance

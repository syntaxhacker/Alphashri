import json
from sqlalchemy import Column, Integer, String, Text, Float, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from .base import Base


class NewsArticle(Base):
    """Stored news articles for symbol tracking and historical analysis."""
    __tablename__ = "news_articles"

    id = Column(Integer, primary_key=True)
    url = Column(String(2048), unique=True, index=True, nullable=False)
    headline = Column(String(500), nullable=False)
    content = Column(Text, nullable=True)
    source = Column(String(50), nullable=False, index=True)
    source_url = Column(String(2048), nullable=True)
    published_at = Column(DateTime, nullable=True, index=True)
    fetched_at = Column(DateTime, server_default=func.now(), index=True)

    sentiment = Column(String(20), nullable=True)
    impact_score = Column(Integer, nullable=True)
    analysis_json = Column(Text, nullable=True)

    symbols = relationship("NewsSymbolMention", back_populates="article", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<NewsArticle(id={self.id}, headline='{self.headline[:50]}...', source='{self.source}')>"

    def to_dict(self) -> dict:
        analysis = None
        if self.analysis_json:
            try:
                analysis = json.loads(self.analysis_json)
            except:
                pass

        summary = analysis.get("summary") if analysis else None

        analysis_status = "done"
        if not self.analysis_json:
            analysis_status = "none"
        elif (
            summary is None
            or "Failed to analyze" in str(summary)
            or "Summary unavailable" in str(summary)
        ):
            analysis_status = "failed"

        return {
            "id": self.id,
            "url": self.url,
            "headline": self.headline,
            "content": self.content,
            "source": self.source,
            "source_url": self.source_url,
            "published_at": self.published_at.isoformat() if self.published_at else None,
            "fetched_at": self.fetched_at.isoformat() if self.fetched_at else None,
            "sentiment": self.sentiment,
            "impact_score": self.impact_score,
            "summary": summary,
            "key_points": analysis.get("key_points") if analysis else None,
            "key_entities": analysis.get("key_entities") if analysis else None,
            "trade_ideas": analysis.get("trade_ideas") if analysis else None,
            "analysis_status": analysis_status,
            "symbols": [s.to_dict() for s in self.symbols] if self.symbols else []
        }


class NewsSymbolMention(Base):
    """Symbols mentioned in news articles, mapped to Upstox instruments."""
    __tablename__ = "news_symbol_mentions"

    id = Column(Integer, primary_key=True)
    article_id = Column(Integer, ForeignKey("news_articles.id"), nullable=False, index=True)

    symbol_code = Column(String(50), nullable=False)
    trading_symbol = Column(String(50), nullable=True)
    instrument_key = Column(String(100), nullable=True)
    company_name = Column(String(200), nullable=True)
    match_confidence = Column(Float, nullable=True)
    match_method = Column(String(20), nullable=True)

    article = relationship("NewsArticle", back_populates="symbols")

    __table_args__ = (
        Index('ix_news_symbol_mentions_instrument_key', 'instrument_key'),
        Index('ix_news_symbol_mentions_trading_symbol', 'trading_symbol'),
    )

    def __repr__(self):
        return f"<NewsSymbolMention(symbol_code='{self.symbol_code}', trading_symbol='{self.trading_symbol}')>"

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "symbol_code": self.symbol_code,
            "trading_symbol": self.trading_symbol,
            "instrument_key": self.instrument_key,
            "company_name": self.company_name,
            "match_confidence": self.match_confidence,
            "match_method": self.match_method
        }


class LLMRun(Base):
    """LLM API call tracking for cost and usage analytics."""
    __tablename__ = "llm_runs"

    id = Column(Integer, primary_key=True)
    uuid = Column(String(36), unique=True, index=True, default=lambda: str(uuid.uuid4()))

    model = Column(String(100), nullable=False, index=True)
    provider = Column(String(50), nullable=True)

    prompt_tokens = Column(Integer, default=0)
    completion_tokens = Column(Integer, default=0)
    total_tokens = Column(Integer, default=0)

    cost_usd = Column(Float, default=0.0)
    response_time_ms = Column(Integer, nullable=True)

    status = Column(String(20), default='pending', index=True)
    error_message = Column(Text, nullable=True)

    url = Column(String(2048), nullable=True)
    headline = Column(String(500), nullable=True)
    request_json = Column(Text, nullable=True)
    response_json = Column(Text, nullable=True)

    created_at = Column(DateTime, server_default=func.now(), index=True)

    def __repr__(self):
        return f"<LLMRun(id={self.id}, model='{self.model}', tokens={self.total_tokens}, cost={self.cost_usd})>"

    def to_dict(self) -> dict:
        return {
            "id": self.uuid,
            "model": self.model,
            "provider": self.provider,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
            "cost_usd": self.cost_usd,
            "response_time_ms": self.response_time_ms,
            "status": self.status,
            "error_message": self.error_message,
            "url": self.url,
            "headline": self.headline,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

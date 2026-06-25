from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func

from .base import Base


class NewsAnalysisQueue(Base):
    """Queue of news articles pending LLM analysis."""
    __tablename__ = "news_analysis_queue"

    id = Column(Integer, primary_key=True)
    article_id = Column(Integer, ForeignKey("news_articles.id"), nullable=False, index=True)

    status = Column(String(20), default="pending", index=True)
    attempt = Column(Integer, default=0)
    error = Column(Text, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    def __repr__(self):
        return f"<NewsAnalysisQueue(id={self.id}, article_id={self.article_id}, status='{self.status}')>"

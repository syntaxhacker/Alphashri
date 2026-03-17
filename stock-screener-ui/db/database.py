"""
Database connection and session management for Alphashri
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
import config

SQLALCHEMY_DATABASE_URL = config.DATABASE_URL

engine_args = {}
if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    engine_args["connect_args"] = {"check_same_thread": False}

engine = create_engine(SQLALCHEMY_DATABASE_URL, **engine_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """Dependency to get database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Initialize database tables."""
    from .models import (
        User, UserSession, StrategyConfig, BotConfig, BacktestResult, BrokerConnection,
        NewsArticle, NewsSymbolMention, LLMRun, Instrument
    )  # noqa: F401
    Base.metadata.create_all(bind=engine)

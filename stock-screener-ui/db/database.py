"""
Database connection and session management for Alphashri
"""

from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
import config

# Database directory and path
DB_DIR = Path(__file__).parent
DB_PATH = DB_DIR / "alphashri.db"

# Use DATABASE_URL from centralized config
SQLALCHEMY_DATABASE_URL = f"sqlite:///{DB_PATH}"

# SQLite-specific engine arguments
engine_args = {}
if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    engine_args["connect_args"] = {"check_same_thread": False}

# Create engine
engine = create_engine(SQLALCHEMY_DATABASE_URL, **engine_args)

# Session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for models
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

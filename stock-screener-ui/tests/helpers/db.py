"""
Database test helpers.

Provides utility functions for common database testing tasks,
such as importing all models to ensure they're registered with Base.metadata.
"""

def import_all_models():
    """Import all SQLAlchemy models to ensure they're registered with Base.metadata."""
    from db.models import (
        User, UserSession, StrategyConfig, BotConfig, BacktestResult,
        BrokerConnection, NewsArticle, NewsSymbolMention, LLMRun, Instrument
    )
    # Import for side effects only - models are registered with Base.metadata upon import
    return locals()

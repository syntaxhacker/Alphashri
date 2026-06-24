import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from alembic import context

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config as app_config
from db.database import Base, engine
from db.models import (
    User, UserSession, StrategyConfig, BotConfig, BacktestResult,
    BrokerConnection, NewsArticle, NewsSymbolMention, LLMRun, Instrument,
    Trade, Position, ChatConversation, ChatMessage,
    Screener, ReplaySavedConfig, MarketHoliday, HolidayType,
    Stock52WeekTouch, Stock52WeekRange,
    bot_strategies,
)

target_metadata = Base.metadata


# --- Alembic migration helpers (for common patterns, to reduce boilerplate in *new* migrations) ---
# IMPORTANT: Historical migration files in versions/ intentionally duplicate small boilerplate
# (table_exists checks, revision headers, create_table defs, etc). This is by design in Alembic
# to keep each migration self-contained and versioned for reliable upgrade/downgrade across
# prod DBs and history. NEVER edit the content of versions/*.py files (breaks down_revision chain
# and applied DB state). See AGENTS.md. These helpers can be used in future non-historical
# migrations if a safe refactor opportunity arises (e.g. new table files).
# jscpd will still flag dups in the versioned history files -- this is expected/acceptable.
import sqlalchemy as sa  # for use in helpers


def table_exists(name: str) -> bool:
    """Helper usable in migration upgrade() for guarded create.
    Safe to call only from within an alembic migration context (where alembic.op is active).
    """
    from alembic import op
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return name in inspector.get_table_names()


def index_exists(name: str, table: str) -> bool:
    """Helper for guarded index create in migrations."""
    from alembic import op
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return name in [idx['name'] for idx in inspector.get_indexes(table)]


def column_exists(table: str, column: str) -> bool:
    """Helper for guarded add_column."""
    from alembic import op
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column in [col["name"] for col in inspector.get_columns(table)]


def run_migrations_offline() -> None:
    url = app_config.DATABASE_URL
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

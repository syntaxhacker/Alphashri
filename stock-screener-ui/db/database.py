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
    """Initialize database tables and run pending migrations."""
    _run_alembic_migrations()


def _run_alembic_migrations():
    """Run Alembic migrations using the app's engine."""
    from pathlib import Path

    from alembic.config import Config
    from alembic import command

    alembic_ini = Path(__file__).resolve().parent.parent / "alembic.ini"
    alembic_cfg = Config(str(alembic_ini))
    alembic_cfg.set_main_option("sqlalchemy.url", SQLALCHEMY_DATABASE_URL)
    command.upgrade(alembic_cfg, "head")

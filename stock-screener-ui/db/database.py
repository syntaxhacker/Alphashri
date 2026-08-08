"""
Database connection and session management for Alphashri
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Bot subprocesses can end up importing the parent project's config.py (the
# repo root /Alphashri/config.py) because runner_core prepends the repo root to
# sys.path for scanner access. That root config points DATABASE_URL at an empty
# SQLite file -> "no such table: bot_configs" crash. Resolve the UI config
# deterministically by importing from this package's own parent directory.
import sys
from pathlib import Path

_UI_DIR = Path(__file__).resolve().parent.parent  # stock-screener-ui/
if str(_UI_DIR) not in sys.path:
    sys.path.insert(0, str(_UI_DIR))

# Force import of the UI's config (stock-screener-ui/config.py), overriding any
# root config already cached under the same module name.
import importlib
import config as _cfg
if Path(_cfg.__file__).resolve().parent != _UI_DIR:
    # A non-UI config was cached; reload the UI one and re-seed the module.
    import importlib.util
    spec = importlib.util.spec_from_file_location("config", _UI_DIR / "config.py")
    _ui_cfg = importlib.util.module_from_spec(spec)
    sys.modules["config"] = _ui_cfg
    spec.loader.exec_module(_ui_cfg)
    _cfg = _ui_cfg

SQLALCHEMY_DATABASE_URL = _cfg.DATABASE_URL

engine_args = {}
if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    engine_args["connect_args"] = {"check_same_thread": False}
else:
    engine_args["pool_pre_ping"] = True
    engine_args["pool_recycle"] = 300

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
    import os
    if os.getenv("SKIP_ALEMBIC"):
        return
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

#!/usr/bin/env python3
"""Local runtime context for the desk/tooling layer.

Five copies of ``_today_ist`` and four of ``_db_path`` were spread across
``scripts/`` and ``options_paper/``. A divergence in either is silent and
expensive: a wrong "today" shifts a session boundary, a wrong DB path points a
read-only query at a different database. Both are now defined once, here.
"""

from __future__ import annotations

import datetime as dt
import pathlib


def today_ist() -> str:
    """Today's date in IST as ``YYYY-MM-DD``."""
    import config

    return dt.datetime.now(config.IST).strftime("%Y-%m-%d")


def ist_hhmmss(ms: float) -> str:
    """An epoch-millisecond timestamp as an IST wall-clock ``HH:MM:SS``."""
    import config

    return (dt.datetime.fromtimestamp(ms / 1000, tz=dt.timezone.utc)
            .astimezone(config.IST).strftime("%H:%M:%S"))


def db_path() -> pathlib.Path:
    """The local SQLite database path.

    ``config.LOCAL_DB_PATH`` is only defined when ``DATABASE_URL`` is unset,
    so the ``db/alphashri.db`` default is the live path in a configured
    environment.
    """
    import config

    path = pathlib.Path(getattr(config, "LOCAL_DB_PATH", "db/alphashri.db"))
    return path if path.is_absolute() else pathlib.Path(config.BASE_DIR) / path

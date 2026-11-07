"""Database session helpers for the bots API.

Centralises the DB-session boilerplate that was duplicated verbatim across
``bot_operations.py``, ``bot_config.py`` and ``bot_status.py`` (22 copies).

Pattern A (the common one)::

    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")
    user_id = get_user_id(user)
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True
    try:
        return await asyncio.to_thread(_sync_fn, ..., db)
    finally:
        if close_db:
            db.close()

Pattern B (``bot_status.py``): ``with SessionLocal() as session:`` wrapping the
same ``_db_available`` / ``SessionLocal`` flag.
"""

import asyncio
from contextlib import contextmanager

from fastapi import HTTPException

from .bots_router import SessionLocal


def require_db(available: bool) -> None:
    """Raise HTTP 500 when the database is not available.

    Callers pass their module-level ``_db_available`` flag explicitly, so the
    long-standing test convention of patching
    ``api.bots_api.<module>._db_available`` keeps working without any frame
    introspection.
    """
    if not available:
        raise HTTPException(status_code=500, detail="Database not available")


@contextmanager
def session_scope(db):
    """Yield a SQLAlchemy session, closing it only when this scope created it.

    If ``db`` is ``None`` a new session is created via ``SessionLocal()`` and
    closed on exit (mirroring the old ``close_db`` flag). If a session was passed
    in (e.g. via FastAPI's ``get_db`` dependency) it is yielded as-is and *not*
    closed here — the caller / dependency owns its lifecycle.
    """
    close_db = db is None
    if close_db:
        db = SessionLocal()
    try:
        yield db
    finally:
        if close_db:
            db.close()


async def run_db(fn, *args, db=None, **kwargs):
    """Run a sync DB function in a worker thread with a session.

    Executes ``fn(*args, session, **kwargs)`` via ``asyncio.to_thread`` so async
    endpoints stay async. The session is created (and closed) locally only when
    ``db`` is ``None``. Callers should invoke :func:`require_db` first.
    """
    with session_scope(db) as session:
        return await asyncio.to_thread(fn, *args, session, **kwargs)

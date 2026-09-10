"""Tests for scripts/backup_db.py — SQLite snapshot + retention."""
import os
import sqlite3
import time

import pytest

from scripts.backup_db import (
    BACKUP_PREFIX,
    has_backup_today,
    prune,
    resolve_sqlite_path,
    run_backup,
)

pytestmark = pytest.mark.unit


def _make_db(path):
    con = sqlite3.connect(path)
    con.execute("create table t (id integer primary key, v text)")
    con.execute("insert into t (v) values ('hello')")
    con.commit()
    con.close()


def test_run_backup_creates_consistent_copy(tmp_path):
    db = tmp_path / "src.db"
    _make_db(db)
    bdir = tmp_path / "bk"

    dest = run_backup(db=str(db), backup_dir=bdir, retention_days=7, quiet=True)

    assert dest is not None and dest.exists()
    assert has_backup_today(bdir)
    con = sqlite3.connect(dest)
    try:
        assert con.execute("select v from t").fetchone()[0] == "hello"
    finally:
        con.close()


def test_skip_if_today_creates_only_one(tmp_path):
    db = tmp_path / "src.db"
    _make_db(db)
    bdir = tmp_path / "bk"

    first = run_backup(db=str(db), backup_dir=bdir, quiet=True)
    second = run_backup(db=str(db), backup_dir=bdir, skip_if_today=True, quiet=True)

    assert first is not None
    assert second is None
    assert len(list(bdir.glob(f"{BACKUP_PREFIX}*.db"))) == 1


def test_prune_removes_backups_older_than_retention(tmp_path):
    bdir = tmp_path / "bk"
    bdir.mkdir()
    old = bdir / f"{BACKUP_PREFIX}20200101_000000.db"
    old.write_bytes(b"old")
    old_ts = time.time() - 10 * 86400
    os.utime(old, (old_ts, old_ts))

    removed = prune(bdir, retention_days=7)

    assert old in removed
    assert not old.exists()


def test_prune_keeps_recent(tmp_path):
    bdir = tmp_path / "bk"
    bdir.mkdir()
    recent = bdir / f"{BACKUP_PREFIX}29990101_000000.db"
    recent.write_bytes(b"new")

    removed = prune(bdir, retention_days=7)

    assert removed == []
    assert recent.exists()


def test_resolve_non_sqlite_returns_none(monkeypatch):
    import config

    monkeypatch.setattr(config, "DATABASE_URL", "postgresql://user:pass@host/db", raising=False)
    assert resolve_sqlite_path() is None


def test_run_backup_missing_source_returns_none(tmp_path):
    dest = run_backup(db=str(tmp_path / "nope.db"), backup_dir=tmp_path / "bk", quiet=True)
    assert dest is None

#!/usr/bin/env python3
"""Automatic local backups of the SQLite database, with retention.

Uses SQLite's online backup API so the snapshot is consistent even while the
API/bots are writing. Backups are written as timestamped copies and copies
older than the retention window are pruned.

Defaults:
  - DB:            config.DATABASE_URL (falls back to db/alphashri.db)
  - Backup dir:    <stock-screener-ui>/backups/db   (env DB_BACKUP_DIR)
  - Retention:     7 days                           (env DB_BACKUP_RETENTION_DAYS)

Usage:
    python scripts/backup_db.py
    python scripts/backup_db.py --retention-days 3
    python scripts/backup_db.py --db db/alphashri.db --backup-dir /tmp/bk
    python scripts/backup_db.py --skip-if-today
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path

_UI_DIR = Path(__file__).resolve().parent.parent
if str(_UI_DIR) not in sys.path:
    sys.path.insert(0, str(_UI_DIR))

BACKUP_PREFIX = "alphashri_"
DEFAULT_RETENTION_DAYS = int(os.getenv("DB_BACKUP_RETENTION_DAYS", "7"))


def default_backup_dir() -> Path:
    env = os.getenv("DB_BACKUP_DIR")
    return Path(env).expanduser().resolve() if env else _UI_DIR / "backups" / "db"


def resolve_sqlite_path(db: str | None = None) -> Path | None:
    """Return the SQLite file path, or None when the DB is not SQLite."""
    if db:
        return Path(db).expanduser().resolve()

    url = ""
    try:
        import config  # type: ignore

        url = getattr(config, "DATABASE_URL", "") or ""
    except Exception:
        url = os.getenv("DATABASE_URL", "")
    if not url:
        return _UI_DIR / "db" / "alphashri.db"
    if not url.startswith("sqlite"):
        return None

    rest = url[len("sqlite:///") :] if url.startswith("sqlite:///") else url.split("sqlite://", 1)[-1].lstrip("/")
    p = Path(rest)
    if not p.is_absolute():
        p = (_UI_DIR / p).resolve()
    return p


def _snapshot(source: Path, dest: Path) -> None:
    src = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    try:
        dst = sqlite3.connect(str(dest))
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()


def prune(backup_dir: Path, retention_days: int) -> list[Path]:
    """Delete backups older than retention_days (by mtime). Returns removed paths."""
    if retention_days < 0 or not backup_dir.exists():
        return []
    cutoff = time.time() - retention_days * 86400
    removed: list[Path] = []
    for f in backup_dir.glob(f"{BACKUP_PREFIX}*.db"):
        try:
            if f.stat().st_mtime < cutoff:
                f.unlink()
                removed.append(f)
        except OSError:
            pass
    return removed


def has_backup_today(backup_dir: Path) -> bool:
    today = datetime.now().strftime("%Y%m%d")
    return backup_dir.exists() and any(backup_dir.glob(f"{BACKUP_PREFIX}{today}_*.db"))


def run_backup(
    db: str | None = None,
    backup_dir: Path | None = None,
    retention_days: int = DEFAULT_RETENTION_DAYS,
    skip_if_today: bool = False,
    quiet: bool = False,
) -> Path | None:
    source = resolve_sqlite_path(db)
    if source is None:
        if not quiet:
            print("⚠️  DB backup skipped: DATABASE_URL is not SQLite")
        return None
    if not source.exists():
        if not quiet:
            print(f"⚠️  DB backup skipped: source not found ({source})")
        return None

    backup_dir = (backup_dir or default_backup_dir()).expanduser().resolve()
    if skip_if_today and has_backup_today(backup_dir):
        return None

    backup_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    dest = backup_dir / f"{BACKUP_PREFIX}{ts}.db"

    try:
        _snapshot(source, dest)
    except Exception:
        if dest.exists():
            dest.unlink()
        raise

    removed = prune(backup_dir, retention_days)
    if not quiet:
        size_mb = dest.stat().st_size / (1024 * 1024)
        print(f"✅ DB backup: {dest} ({size_mb:.1f} MB)")
        if removed:
            print(f"🧹 Pruned {len(removed)} backup(s) older than {retention_days}d")
    return dest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Back up the SQLite database with retention.")
    parser.add_argument("--db", help="SQLite DB path (default: config.DATABASE_URL)")
    parser.add_argument("--backup-dir", help="Destination dir (default: backups/db)")
    parser.add_argument("--retention-days", type=int, default=DEFAULT_RETENTION_DAYS)
    parser.add_argument("--skip-if-today", action="store_true", help="No-op if a backup already exists for today")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args(argv)

    try:
        dest = run_backup(
            db=args.db,
            backup_dir=Path(args.backup_dir) if args.backup_dir else None,
            retention_days=args.retention_days,
            skip_if_today=args.skip_if_today,
            quiet=args.quiet,
        )
    except Exception as e:  # noqa: BLE001
        print(f"❌ DB backup failed: {e}")
        return 1
    return 0 if dest is not None else 0


if __name__ == "__main__":
    raise SystemExit(main())

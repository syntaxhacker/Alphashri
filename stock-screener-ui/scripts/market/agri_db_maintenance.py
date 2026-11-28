#!/usr/bin/env python3
"""Safe, explicit maintenance for the local agri SQLite cache.

The cache is a shared read-only artefact. ``--check`` (the default) opens it
with ``mode=ro`` + ``query_only=ON`` and only reads integrity, size, index and
count metadata. ``--optimize`` and ``--vacuum`` are deliberately separate and
write only where noted below. Nothing here deletes rows, drops indexes or
reports, or invents data. Every SQL statement is a fixed literal; the ``--db``
value is never interpolated into SQL.

Modes
-----
``--check``
    Read-only: ``PRAGMA quick_check``, page/freelist and DB/WAL/SHM byte sizes,
    every index with its key columns, duplicate/redundant-index analysis
    (leading-column coverage), and row/partition counts. No DDL, no rows
    touched. ``quick_check`` scans the whole file, so it can take minutes on
    the ~900 MB cache; ``--no-quick-check`` gives a faster metadata-only pass.

``--optimize``
    Opens ``mode=rw``, runs a few representative reads so the planner knows
    which tables matter, then ``PRAGMA optimize`` and a ``PASSIVE`` WAL
    checkpoint. Safe while the API reads: ``optimize`` may update the tiny
    ``sqlite_stat1`` table under a short write lock, and a ``PASSIVE``
    checkpoint never waits for readers. A concurrent writer may cause either
    step to be skipped; the report says so instead of failing silently.

``--vacuum`` (requires ``--yes``)
    Offline maintenance only. Rebuilds the whole file, so it needs free space
    and no other readers/writers. The tool warns, checks free space (main DB +
    WAL + 10% headroom), refuses when a write lock or WAL shared-memory lock
    is held, and only then runs ``VACUUM``. It never removes rows: logical
    contents are unchanged, only free pages are reclaimed. On the real cache
    this is an exception to the golden "never hand-edit the cache" rule and
    requires the data owner to take the app offline first.

Paths are allow-listed: only the canonical ``reports/agri/agri_prices.db`` is
accepted by the CLI (symlinks are resolved). Errors are redacted before they
are printed — file paths become ``<db>`` / ``<path>`` and messages are
truncated — so logs do not leak the local filesystem layout.

Usage::

    .venv/bin/python scripts/market/agri_db_maintenance.py                 # --check
    .venv/bin/python scripts/market/agri_db_maintenance.py --check --json
    .venv/bin/python scripts/market/agri_db_maintenance.py --check --no-quick-check
    .venv/bin/python scripts/market/agri_db_maintenance.py --optimize
    .venv/bin/python scripts/market/agri_db_maintenance.py --vacuum --yes  # offline only
"""

from __future__ import annotations

import argparse
import errno
import json
import os
import re
import shutil
import sqlite3
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

try:  # POSIX-only lock probing; other platforms simply skip that check.
    import fcntl
except ImportError:  # pragma: no cover - exercised only on non-POSIX hosts
    fcntl = None  # type: ignore[assignment]

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from api.agri import store  # noqa: E402

DEFAULT_DB_PATH: Path = store.DEFAULT_DB_PATH
ALLOWED_DB_PATHS: tuple[Path, ...] = (DEFAULT_DB_PATH,)
PRICE_TABLE: str = store.TABLE
LEDGER_TABLE: str = store.LEDGER_TABLE
MMAP_BYTES: int = 2_147_483_648
VACUUM_HEADROOM: float = 0.10
VACUUM_MIN_EXTRA_BYTES: int = 1024 * 1024
# SQLite's Unix WAL shared-memory lock bytes (UNIX_SHM_BASE + WAL_*_LOCK).
SHM_LOCK_OFFSETS: tuple[tuple[int, str], ...] = (
    (120, "WAL writer"),
    (121, "WAL checkpoint"),
    (122, "WAL recovery"),
    (123, "WAL reader slot 1"),
    (124, "WAL reader slot 2"),
    (125, "WAL reader slot 3"),
    (126, "WAL reader slot 4"),
    (127, "WAL reader slot 5"),
)


class MaintenanceError(RuntimeError):
    """An expected failure (reported without a traceback)."""


class RefusalError(MaintenanceError):
    """A safety rule refused the requested action."""


def _redact(message: Any, db_path: Optional[Path] = None) -> str:
    """Strip local paths and noise from an error before showing it to a user."""
    text = " ".join(str(message).split())
    tokens: list[str] = []
    if db_path is not None:
        try:
            resolved = db_path.resolve()
        except OSError:
            resolved = db_path
        tokens.extend([str(db_path), str(resolved), f"file:{resolved}"])
    home = str(Path.home())
    if home and home != "/":
        tokens.append(home)
    for token in sorted(set(tokens), key=len, reverse=True):
        if token:
            text = text.replace(token, "<db>" if db_path is not None else "<path>")
    # Any other absolute filesystem path is still local detail, not diagnosis.
    text = re.sub(r"(?<![\w/])/(?:[\w.@\-]+/)+[\w.@\-]+", "<path>", text)
    if len(text) > 400:
        text = text[:397] + "..."
    return text


def redact_error(exc: BaseException, db_path: Optional[Path] = None) -> str:
    return f"{type(exc).__name__}: {_redact(exc, db_path)}"


def require_file(path: Path) -> Path:
    if not path.exists():
        raise MaintenanceError("Agri DB not found")
    if not path.is_file():
        raise MaintenanceError("Agri DB path is not a regular file")
    return path


def resolve_db_path(
    value: Optional[str | Path] = None,
    *,
    allowed: Optional[Iterable[str | Path]] = None,
) -> Path:
    """Resolve and allow-list the DB path; never accept an arbitrary file."""
    candidates = ALLOWED_DB_PATHS if allowed is None else allowed
    target = Path(value) if value is not None else DEFAULT_DB_PATH
    if str(target) in (":memory:", ""):
        raise RefusalError("refusing unknown DB path: in-memory databases are not supported")
    resolved = target.resolve()
    allowed_set = {Path(item).resolve() for item in candidates}
    if resolved not in allowed_set:
        raise RefusalError(
            "refusing unknown DB path: only the canonical agri cache is allowed"
        )
    return require_file(resolved)


def open_read_only(db_path: Path) -> sqlite3.Connection:
    """Strictly read-only connection; never creates or migrates the cache."""
    conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA query_only=ON")
        conn.execute("PRAGMA busy_timeout=5000")
        # Connection-local mmap keeps the large index/integrity scans cheap.
        conn.execute(f"PRAGMA mmap_size={MMAP_BYTES}")
    except BaseException:
        conn.close()
        raise
    return conn


def open_read_write(db_path: Path) -> sqlite3.Connection:
    """Connection for the two explicit maintenance modes; no schema changes."""
    conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=rw", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA busy_timeout=5000")
    except BaseException:
        conn.close()
        raise
    return conn


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()
    return row is not None


def _fmt_bytes(size: int) -> str:
    value = float(size)
    for unit in ("B", "KiB", "MiB", "GiB"):
        if value < 1024 or unit == "GiB":
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1024
    return f"{size} B"


# ---------------------------------------------------------------------------
# Check (read-only)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SizeInfo:
    page_size: int
    page_count: int
    freelist_count: int
    main_bytes: int
    wal_bytes: int
    shm_bytes: int

    @property
    def logical_bytes(self) -> int:
        return self.page_size * self.page_count

    def as_dict(self) -> dict[str, int]:
        return {
            "page_size": self.page_size,
            "page_count": self.page_count,
            "freelist_count": self.freelist_count,
            "logical_bytes": self.logical_bytes,
            "main_bytes": self.main_bytes,
            "wal_bytes": self.wal_bytes,
            "shm_bytes": self.shm_bytes,
        }


@dataclass(frozen=True)
class IndexInfo:
    table: str
    name: str
    columns: tuple[str, ...]
    signature: tuple[tuple[str, str, int], ...]
    unique: bool
    origin: str
    partial: bool
    where_sql: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "table": self.table,
            "name": self.name,
            "columns": list(self.columns),
            "unique": self.unique,
            "origin": self.origin,
            "partial": self.partial,
        }


@dataclass(frozen=True)
class Redundancy:
    table: str
    redundant: str
    covered_by: str
    columns: tuple[str, ...]
    kind: str  # "duplicate" | "leading-column prefix"
    note: str = "Review and drop via a schema change only; nothing is dropped here."

    def as_dict(self) -> dict[str, Any]:
        return {
            "table": self.table,
            "redundant": self.redundant,
            "covered_by": self.covered_by,
            "columns": list(self.columns),
            "kind": self.kind,
            "note": self.note,
        }


@dataclass(frozen=True)
class CheckResult:
    db: str
    checked_at: str
    read_only: bool
    quick_check_run: bool
    integrity: str
    integrity_ok: bool
    journal_mode: str
    sizes: SizeInfo
    indexes: tuple[IndexInfo, ...]
    redundant: tuple[Redundancy, ...]
    rows: dict[str, int]
    partitions: tuple[dict[str, Any], ...]
    distinct_dates: int
    first_date: Optional[str]
    last_date: Optional[str]
    commodity_keys: int

    def as_dict(self) -> dict[str, Any]:
        return {
            "mode": "check",
            "db": self.db,
            "checked_at": self.checked_at,
            "read_only": self.read_only,
            "quick_check_run": self.quick_check_run,
            "integrity": self.integrity,
            "integrity_ok": self.integrity_ok,
            "journal_mode": self.journal_mode,
            "sizes": self.sizes.as_dict(),
            "indexes": [item.as_dict() for item in self.indexes],
            "redundant_indexes": [item.as_dict() for item in self.redundant],
            "rows": dict(self.rows),
            "partitions": [dict(item) for item in self.partitions],
            "distinct_dates": self.distinct_dates,
            "first_date": self.first_date,
            "last_date": self.last_date,
            "commodity_keys": self.commodity_keys,
        }


def read_integrity(conn: sqlite3.Connection) -> str:
    problems = [str(row[0]) for row in conn.execute("PRAGMA quick_check")]
    return "ok" if problems == ["ok"] else "; ".join(problems) or "no result"


def read_sizes(conn: sqlite3.Connection, db_path: Path) -> SizeInfo:
    page_size = int(conn.execute("PRAGMA page_size").fetchone()[0])
    page_count = int(conn.execute("PRAGMA page_count").fetchone()[0])
    freelist = int(conn.execute("PRAGMA freelist_count").fetchone()[0])

    def sidecar(suffix: str) -> int:
        path = Path(str(db_path) + suffix)
        try:
            return path.stat().st_size
        except OSError:
            return 0

    return SizeInfo(
        page_size=page_size,
        page_count=page_count,
        freelist_count=freelist,
        main_bytes=db_path.stat().st_size,
        wal_bytes=sidecar("-wal"),
        shm_bytes=sidecar("-shm"),
    )


def _partial_where(sql: str | None) -> str:
    """Extract the WHERE clause of a partial index for like-for-like comparison."""
    if not sql:
        return ""
    match = re.search(r"\bWHERE\b(.*)$", sql, re.IGNORECASE | re.DOTALL)
    return " ".join(match.group(1).split()).rstrip(";") if match else ""


def read_indexes(conn: sqlite3.Connection) -> tuple[IndexInfo, ...]:
    out: list[IndexInfo] = []
    for table in (PRICE_TABLE, LEDGER_TABLE):
        if not _table_exists(conn, table):
            continue
        for row in conn.execute(f'PRAGMA index_list("{table}")'):
            name = str(row["name"])
            sql_row = conn.execute(
                "SELECT sql FROM sqlite_master WHERE type='index' AND name=?", (name,)
            ).fetchone()
            sql = str(sql_row[0]) if sql_row and sql_row[0] else ""
            signature: list[tuple[str, str, int]] = []
            columns: list[str] = []
            for info in conn.execute(f'PRAGMA index_xinfo("{name}")'):
                if not info["key"] or info["name"] is None:
                    continue  # appended rowid/covering column, not a key
                columns.append(str(info["name"]))
                signature.append((str(info["name"]), str(info["coll"]), int(info["desc"])))
            out.append(
                IndexInfo(
                    table=table,
                    name=name,
                    columns=tuple(columns),
                    signature=tuple(signature),
                    unique=bool(row["unique"]),
                    origin=str(row["origin"]),
                    partial=bool(row["partial"]),
                    where_sql=_partial_where(sql) if row["partial"] else "",
                )
            )
    return tuple(sorted(out, key=lambda item: (item.table, item.name)))


def find_redundant_indexes(indexes: Iterable[IndexInfo]) -> tuple[Redundancy, ...]:
    """Flag explicit, non-unique indexes whose keys are duplicated or prefixed.

    ``idx_a(b)`` is redundant when ``idx_b(b, c)`` exists on the same table:
    the longer index's leading-column coverage serves the same lookups.
    UNIQUE/primary-key autoindexes are skipped in both roles (they enforce
    constraints), and partial indexes only match an identical WHERE clause.
    """
    by_table: dict[str, list[IndexInfo]] = defaultdict(list)
    for index in indexes:
        if index.origin == "c" and not index.unique and index.signature:
            by_table[index.table].append(index)

    found: list[Redundancy] = []
    for table, candidates in by_table.items():
        for i, left in enumerate(candidates):
            for right in candidates[i + 1:]:
                if left.partial != right.partial:
                    continue
                if left.partial and left.where_sql != right.where_sql:
                    continue
                a, b = left.signature, right.signature
                if a == b:
                    # Identical keys: keep the first name, flag the later one.
                    kind = "duplicate"
                    drop, keep = right, left
                elif len(a) < len(b) and b[: len(a)] == a:
                    kind = "leading-column prefix"
                    drop, keep = left, right
                elif len(b) < len(a) and a[: len(b)] == b:
                    kind = "leading-column prefix"
                    drop, keep = right, left
                else:
                    continue
                found.append(
                    Redundancy(
                        table=table,
                        redundant=drop.name,
                        covered_by=keep.name,
                        columns=drop.columns,
                        kind=kind,
                    )
                )
    return tuple(sorted(found, key=lambda item: (item.table, item.redundant)))


def read_counts(conn: sqlite3.Connection) -> dict[str, Any]:
    rows: dict[str, int] = {}
    for table in (PRICE_TABLE, LEDGER_TABLE):
        rows[table] = (
            int(conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])
            if _table_exists(conn, table)
            else 0
        )
    partitions: tuple[dict[str, Any], ...] = ()
    if _table_exists(conn, LEDGER_TABLE):
        partitions = tuple(
            {"status": str(row[0]), "count": int(row[1])}
            for row in conn.execute(
                f'SELECT status, COUNT(*) FROM "{LEDGER_TABLE}" '
                "GROUP BY status ORDER BY status"
            )
        )
    distinct_dates = first = last = None
    keys = 0
    if _table_exists(conn, PRICE_TABLE):
        distinct_dates, first, last = conn.execute(
            f'SELECT COUNT(DISTINCT date), MIN(date), MAX(date) FROM "{PRICE_TABLE}"'
        ).fetchone()
        keys = int(conn.execute(
            f'SELECT COUNT(DISTINCT commodity_key) FROM "{PRICE_TABLE}"'
        ).fetchone()[0])
    return {
        "rows": rows,
        "partitions": partitions,
        "distinct_dates": int(distinct_dates or 0),
        "first_date": first,
        "last_date": last,
        "commodity_keys": keys,
    }


def run_check(db_path: str | Path, *, quick_check: bool = True) -> CheckResult:
    """Build the read-only report. ``db_path`` must already be allow-listed."""
    path = require_file(Path(db_path))
    conn = open_read_only(path)
    try:
        integrity = read_integrity(conn) if quick_check else "not run"
        journal_mode = str(conn.execute("PRAGMA journal_mode").fetchone()[0])
        sizes = read_sizes(conn, path)
        indexes = read_indexes(conn)
        counts = read_counts(conn)
        return CheckResult(
            db=str(path),
            checked_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            read_only=True,
            quick_check_run=quick_check,
            integrity=integrity,
            integrity_ok=(integrity == "ok") if quick_check else False,
            journal_mode=journal_mode,
            sizes=sizes,
            indexes=indexes,
            redundant=find_redundant_indexes(indexes),
            rows=counts["rows"],
            partitions=counts["partitions"],
            distinct_dates=counts["distinct_dates"],
            first_date=counts["first_date"],
            last_date=counts["last_date"],
            commodity_keys=counts["commodity_keys"],
        )
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Optimize (explicit)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class OptimizeResult:
    db: str
    journal_mode: str
    checkpoint_mode: str
    checkpoint: tuple[int, int, int]  # (busy, log, checkpointed)
    tables_read: tuple[str, ...]

    def as_dict(self) -> dict[str, Any]:
        return {
            "mode": "optimize",
            "db": self.db,
            "journal_mode": self.journal_mode,
            "checkpoint_mode": self.checkpoint_mode,
            "checkpoint": {
                "busy": self.checkpoint[0],
                "log_frames": self.checkpoint[1],
                "checkpointed_frames": self.checkpoint[2],
            },
            "tables_read": list(self.tables_read),
            "note": (
                "PRAGMA optimize may refresh sqlite_stat1 under a short write lock; "
                "PASSIVE checkpoint never waits for readers."
            ),
        }


def run_optimize(db_path: str | Path) -> OptimizeResult:
    """Run ``PRAGMA optimize`` then a PASSIVE WAL checkpoint (app may keep reading)."""
    path = require_file(Path(db_path))
    conn = open_read_write(path)
    try:
        journal_mode = str(conn.execute("PRAGMA journal_mode").fetchone()[0])
        tables: list[str] = []
        for table in (PRICE_TABLE, LEDGER_TABLE):
            if _table_exists(conn, table):
                conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()
                tables.append(table)
        conn.execute("PRAGMA optimize")
        checkpoint = (0, 0, 0)
        if journal_mode == "wal":
            checkpoint = tuple(conn.execute("PRAGMA wal_checkpoint(PASSIVE)").fetchone())
        return OptimizeResult(
            db=str(path),
            journal_mode=journal_mode,
            checkpoint_mode="PASSIVE" if journal_mode == "wal" else "n/a",
            checkpoint=checkpoint,
            tables_read=tuple(tables),
        )
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Vacuum (offline, explicitly confirmed)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class VacuumResult:
    db: str
    before_bytes: int
    after_bytes: int
    freelist_before: int
    free_space_bytes: int
    required_space_bytes: int

    @property
    def reclaimed_bytes(self) -> int:
        return self.before_bytes - self.after_bytes

    def as_dict(self) -> dict[str, Any]:
        return {
            "mode": "vacuum",
            "db": self.db,
            "before_bytes": self.before_bytes,
            "after_bytes": self.after_bytes,
            "reclaimed_bytes": self.reclaimed_bytes,
            "freelist_before": self.freelist_before,
            "free_space_bytes": self.free_space_bytes,
            "required_space_bytes": self.required_space_bytes,
        }


def _shm_lock_held(shm: Path) -> Optional[str]:
    """Probe SQLite's WAL shared-memory lock bytes without holding them."""
    if fcntl is None or not shm.exists():
        return None
    try:
        fd = os.open(shm, os.O_RDWR)
    except OSError:
        return None
    try:
        for offset, label in SHM_LOCK_OFFSETS:
            try:
                fcntl.lockf(fd, fcntl.LOCK_EX | fcntl.LOCK_NB, 1, offset, os.SEEK_SET)
                fcntl.lockf(fd, fcntl.LOCK_UN, 1, offset, os.SEEK_SET)
            except OSError as exc:
                if exc.errno in (errno.EACCES, errno.EAGAIN):
                    return label
                raise
    finally:
        os.close(fd)
    return None


def detect_in_use(db_path: Path) -> Optional[str]:
    """Return a short reason when the DB has active readers/writers, else None."""
    conn = open_read_write(db_path)
    try:
        conn.execute("PRAGMA busy_timeout=0")
        try:
            conn.execute("BEGIN EXCLUSIVE")
        except sqlite3.Error:
            return "an active writer holds the database lock"
        finally:
            try:
                conn.execute("ROLLBACK")
            except sqlite3.Error:
                pass
    finally:
        conn.close()

    held = _shm_lock_held(Path(str(db_path) + "-shm"))
    if held:
        return f"active {held} lock on the WAL shared-memory file"
    journal = Path(str(db_path) + "-journal")
    if journal.exists() and journal.stat().st_size > 0:
        return "a hot rollback journal is present"
    return None


def run_vacuum(
    db_path: str | Path,
    *,
    confirm: bool = False,
    in_use_probe: Any = detect_in_use,
) -> VacuumResult:
    """VACUUM only after confirmation, a free-space check and an in-use check."""
    if not confirm:
        raise RefusalError("VACUUM rebuilds the whole file and requires --yes")
    path = require_file(Path(db_path))
    conn = open_read_only(path)
    try:
        sizes = read_sizes(conn, path)
    finally:
        conn.close()

    required = int((sizes.main_bytes + sizes.wal_bytes) * (1 + VACUUM_HEADROOM))
    required = max(required, sizes.main_bytes + VACUUM_MIN_EXTRA_BYTES)
    free = shutil.disk_usage(path.parent).free
    if free < required:
        raise RefusalError(
            f"insufficient free space for VACUUM: need about {_fmt_bytes(required)}, "
            f"have {_fmt_bytes(free)}"
        )

    reason = in_use_probe(path)
    if reason:
        raise RefusalError(
            f"agri DB is in use ({reason}); VACUUM refused - take the app offline first"
        )

    conn = open_read_write(path)
    try:
        conn.execute("PRAGMA busy_timeout=0")  # fail fast, never wait on the app
        before = sizes.main_bytes
        freelist = sizes.freelist_count
        conn.execute("VACUUM")
        if sizes.wal_bytes or conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal":
            conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
        after = path.stat().st_size
        return VacuumResult(
            db=str(path),
            before_bytes=before,
            after_bytes=after,
            freelist_before=freelist,
            free_space_bytes=free,
            required_space_bytes=required,
        )
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# CLI / reporting
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Read-only health check and explicit maintenance for the agri SQLite cache.",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="read-only report (default)")
    mode.add_argument("--optimize", action="store_true", help="PRAGMA optimize + PASSIVE WAL checkpoint")
    mode.add_argument("--vacuum", action="store_true", help="offline-only VACUUM (needs --yes)")
    parser.add_argument(
        "--db", type=Path, default=DEFAULT_DB_PATH,
        help=f"Local agri SQLite cache (default: {DEFAULT_DB_PATH})",
    )
    parser.add_argument("--json", action="store_true", help="emit a JSON report")
    parser.add_argument("--yes", action="store_true", help="required confirmation for --vacuum")
    parser.add_argument(
        "--no-quick-check", action="store_true",
        help="skip the whole-file integrity scan (check mode only; still read-only)",
    )
    return parser


def _print_check(result: CheckResult) -> None:
    size = result.sizes
    print("Agri DB maintenance - check (read-only)")
    print(f"DB: {result.db}")
    print(f"Integrity (quick_check): {result.integrity}")
    print(f"Journal mode: {result.journal_mode}")
    print(
        f"Pages: {size.page_count} x {size.page_size} = {_fmt_bytes(size.logical_bytes)} "
        f"(freelist: {size.freelist_count} pages)"
    )
    print(
        f"Files: main {_fmt_bytes(size.main_bytes)}, WAL {_fmt_bytes(size.wal_bytes)}, "
        f"SHM {_fmt_bytes(size.shm_bytes)}"
    )
    print("Rows: " + ", ".join(f"{k}={v}" for k, v in result.rows.items()))
    print(
        "Partitions: "
        + (", ".join(f"{p['status']}={p['count']}" for p in result.partitions) or "none")
    )
    print(
        f"Dates: {result.distinct_dates} ({result.first_date} .. {result.last_date}); "
        f"commodity keys: {result.commodity_keys}"
    )
    print(f"Indexes ({len(result.indexes)}):")
    for index in result.indexes:
        print(
            f"  {index.name} [{', '.join(index.columns)}] "
            f"unique={index.unique} origin={index.origin} partial={index.partial}"
        )
    print(f"Redundant/duplicate indexes ({len(result.redundant)}):")
    for item in result.redundant:
        print(
            f"  {item.redundant} -> {item.covered_by} ({item.kind}: {', '.join(item.columns)})"
        )
    print("Advisory only: no DDL was executed and no rows were changed.")


def _print_optimize(result: OptimizeResult) -> None:
    cp = result.checkpoint
    print("Agri DB maintenance - optimize")
    print(f"DB: {result.db}")
    print(f"PRAGMA optimize: ok (tables read: {', '.join(result.tables_read) or 'none'})")
    print(
        f"WAL checkpoint ({result.checkpoint_mode}): busy={cp[0]}, "
        f"log={cp[1]}, checkpointed={cp[2]}"
    )
    print("No rows were changed; sqlite_stat1 may have been refreshed.")


def _print_vacuum(result: VacuumResult) -> None:
    print("Agri DB maintenance - vacuum")
    print(f"DB: {result.db}")
    print(
        f"Size: {_fmt_bytes(result.before_bytes)} -> {_fmt_bytes(result.after_bytes)} "
        f"(reclaimed {_fmt_bytes(result.reclaimed_bytes)}, "
        f"freelist before {result.freelist_before} pages)"
    )
    print(
        f"Free space at start: {_fmt_bytes(result.free_space_bytes)} "
        f"(required about {_fmt_bytes(result.required_space_bytes)})"
    )
    print("No rows were deleted; logical contents are unchanged.")


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    mode = "vacuum" if args.vacuum else "optimize" if args.optimize else "check"
    if mode == "vacuum" and not args.yes:
        print(
            "ERROR: --vacuum requires --yes (offline maintenance only)",
            file=sys.stderr,
        )
        return 2
    if mode != "check" and args.no_quick_check:
        print("ERROR: --no-quick-check is only valid with --check", file=sys.stderr)
        return 2

    path: Optional[Path] = None
    try:
        path = resolve_db_path(args.db)
        if mode == "optimize":
            result: Any = run_optimize(path)
        elif mode == "vacuum":
            print(
                "WARNING: VACUUM requires the agri cache to be offline (no API reader or "
                "collector). On the real cache this needs the data owner's approval.",
                file=sys.stderr,
            )
            result = run_vacuum(path, confirm=args.yes)
        else:
            result = run_check(path, quick_check=not args.no_quick_check)
    except (MaintenanceError, sqlite3.Error, OSError) as exc:
        print(f"ERROR: {redact_error(exc, path)}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(result.as_dict(), indent=2, default=str))
    elif mode == "optimize":
        _print_optimize(result)
    elif mode == "vacuum":
        _print_vacuum(result)
    else:
        _print_check(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

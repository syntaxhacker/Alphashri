"""SQLite cache for Agmarknet mandi prices.

The router opens this database read-only; the importer and the daily collector
open it as a writer. Paths resolve from the project root, never the CWD.
"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any, Iterable, Optional

ROOT: Path = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH: Path = ROOT / "reports" / "agri" / "agri_prices.db"

TABLE: str = "agri_mandi_prices"
COLUMNS: tuple[str, ...] = (
    "date", "state", "district", "market", "commodity", "commodity_key",
    "variety", "grade", "min_price", "max_price", "modal_price",
    "arrivals_qtl", "price_unit", "source",
)

SCHEMA_SQL: str = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    date           DATE NOT NULL,
    state          TEXT NOT NULL DEFAULT '',
    district       TEXT NOT NULL DEFAULT '',
    market         TEXT NOT NULL DEFAULT '',
    commodity      TEXT NOT NULL,
    commodity_key  TEXT NOT NULL,
    variety        TEXT NOT NULL DEFAULT '',
    grade          TEXT NOT NULL DEFAULT '',
    min_price      FLOAT NULL,
    max_price      FLOAT NULL,
    modal_price    FLOAT NULL,
    arrivals_qtl   FLOAT NULL,
    price_unit     TEXT NOT NULL DEFAULT '',
    source         TEXT NOT NULL DEFAULT '',
    UNIQUE(date, state, district, market, commodity, variety, grade)
);
CREATE INDEX IF NOT EXISTS idx_agri_date ON {TABLE}(date);
CREATE INDEX IF NOT EXISTS idx_agri_commodity_key ON {TABLE}(commodity_key);
CREATE INDEX IF NOT EXISTS idx_agri_key_date ON {TABLE}(commodity_key, date);
CREATE INDEX IF NOT EXISTS idx_agri_state ON {TABLE}(state);
"""

_UPSERT_SQL: str = f"""
INSERT INTO {TABLE} ({', '.join(COLUMNS)})
VALUES ({', '.join('?' for _ in COLUMNS)})
ON CONFLICT(date, state, district, market, commodity, variety, grade) DO UPDATE SET
    commodity_key=excluded.commodity_key,
    min_price=excluded.min_price,
    max_price=excluded.max_price,
    modal_price=excluded.modal_price,
    arrivals_qtl=excluded.arrivals_qtl,
    price_unit=excluded.price_unit,
    source=excluded.source
"""


def default_db_path() -> Path:
    override = os.getenv("AGRI_DB_PATH")
    return Path(override) if override else DEFAULT_DB_PATH


def _resolve(path: Optional[str | Path]) -> Path:
    return Path(path) if path is not None else default_db_path()


def _connect(path: Path, *, read_only: bool) -> sqlite3.Connection:
    if str(path) == ":memory:" or path.name == ":memory:":
        conn = sqlite3.connect(":memory:")
    elif read_only:
        conn = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_SQL)


def open_writer(path: Optional[str | Path] = None) -> sqlite3.Connection:
    """Open (and initialise) the cache for import/collector writes."""
    conn = _connect(_resolve(path), read_only=False)
    ensure_schema(conn)
    return conn


def open_reader(path: Optional[str | Path] = None) -> Optional[sqlite3.Connection]:
    """Open the cache read-only. ``None`` means "no cache on disk"."""
    target = _resolve(path)
    if str(target) != ":memory:" and not target.exists():
        return None
    conn = _connect(target, read_only=True)
    conn.execute("SELECT 1 FROM sqlite_master LIMIT 1").fetchone()
    return conn


def upsert_rows(conn: sqlite3.Connection, rows: Iterable[dict[str, Any]]) -> int:
    """Insert or refresh rows keyed by (date, geography, commodity, variety, grade)."""
    batch = [
        tuple(row.get(column) if row.get(column) is not None else None for column in COLUMNS)
        for row in rows
    ]
    if not batch:
        return 0
    with conn:
        conn.executemany(_UPSERT_SQL, batch)
    return len(batch)


def fetch_rows(
    conn: sqlite3.Connection,
    *,
    commodity_names: Optional[Iterable[str]] = None,
    states: Optional[Iterable[str]] = None,
    districts: Optional[Iterable[str]] = None,
    markets: Optional[Iterable[str]] = None,
    on_date: Optional[str] = None,
    on_dates: Optional[Iterable[str]] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    limit: Optional[int] = None,
) -> list[dict[str, Any]]:
    clauses: list[str] = []
    params: list[Any] = []

    def add(column: str, values: Iterable[str]) -> None:
        items = list(values)
        if items:
            clauses.append(f"{column} IN ({', '.join('?' for _ in items)})")
            params.extend(items)

    add("commodity", commodity_names or ())
    add("state", states or ())
    add("district", districts or ())
    add("market", markets or ())

    if on_date:
        clauses.append("date = ?")
        params.append(on_date)
    if on_dates:
        dates = list(on_dates)
        if dates:
            clauses.append(f"date IN ({', '.join('?' for _ in dates)})")
            params.extend(dates)
    if from_date:
        clauses.append("date >= ?")
        params.append(from_date)
    if to_date:
        clauses.append("date <= ?")
        params.append(to_date)

    sql = f"SELECT {', '.join(COLUMNS)} FROM {TABLE}"
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY date, state, district, market, commodity, variety, grade"
    if limit is not None:
        sql += " LIMIT ?"
        params.append(limit)
    return [dict(row) for row in conn.execute(sql, params)]


def latest_date(
    conn: sqlite3.Connection,
    *,
    commodity_names: Optional[Iterable[str]] = None,
    states: Optional[Iterable[str]] = None,
    districts: Optional[Iterable[str]] = None,
    markets: Optional[Iterable[str]] = None,
) -> Optional[str]:
    """MAX(date) under the same filters the prices endpoint applies."""
    clauses: list[str] = []
    params: list[Any] = []
    for column, values in (
        ("commodity", commodity_names), ("state", states),
        ("district", districts), ("market", markets),
    ):
        items = list(values or ())
        if items:
            clauses.append(f"{column} IN ({', '.join('?' for _ in items)})")
            params.extend(items)
    sql = f"SELECT MAX(date) FROM {TABLE}"
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    return conn.execute(sql, params).fetchone()[0]


_OPTIONS_CACHE: dict[tuple[str, float, int], dict[str, Any]] = {}


def fetch_options(conn: sqlite3.Connection) -> dict[str, Any]:
    """Filter metadata, cached until the cache file changes.

    ``SELECT DISTINCT`` over 1.2M rows took ~1.3s on every request; the option
    lists only change when an import/collector writes the DB.
    """
    path_row = conn.execute("PRAGMA database_list").fetchone()
    path = str(path_row[2] or "") if path_row else ""
    cache_key = None
    if path:
        try:
            stat = os.stat(path)
            cache_key = (path, stat.st_mtime, stat.st_size)
            cached = _OPTIONS_CACHE.get(cache_key)
            if cached is not None:
                return dict(cached)
        except OSError:
            cache_key = None
    as_of = conn.execute(f"SELECT MAX(date) FROM {TABLE}").fetchone()[0]
    states = [r[0] for r in conn.execute(f"SELECT DISTINCT state FROM {TABLE} WHERE state <> '' ORDER BY state")]
    districts = [r[0] for r in conn.execute(f"SELECT DISTINCT district FROM {TABLE} WHERE district <> '' ORDER BY district")]
    markets = [r[0] for r in conn.execute(f"SELECT DISTINCT market FROM {TABLE} WHERE market <> '' ORDER BY market")]
    result = {"as_of": as_of, "states": states, "districts": districts, "markets": markets}
    if cache_key is not None:
        if len(_OPTIONS_CACHE) >= 4:
            _OPTIONS_CACHE.clear()
        _OPTIONS_CACHE[cache_key] = dict(result)
    return result


def anchor_dates(
    conn: sqlite3.Connection,
    key_to_names: dict[str, tuple[str, ...]],
    as_of: str,
    offsets_days: Iterable[int],
) -> dict[str, dict[int, Optional[str]]]:
    """Nearest available date <= (as_of - offset) for each commodity key."""
    out: dict[str, dict[int, Optional[str]]] = {}
    for key, names in key_to_names.items():
        found: dict[int, Optional[str]] = {}
        for days in offsets_days:
            target = _shift_iso(as_of, -days)
            placeholders = ", ".join("?" for _ in names)
            row = conn.execute(
                f"SELECT MAX(date) FROM {TABLE} "
                f"WHERE commodity IN ({placeholders}) AND date <= ?",
                (*names, target),
            ).fetchone()
            found[days] = row[0] if row else None
        out[key] = found
    return out


def count_rows(conn: sqlite3.Connection) -> int:
    return int(conn.execute(f"SELECT COUNT(*) FROM {TABLE}").fetchone()[0])


def date_range(conn: sqlite3.Connection) -> tuple[Optional[str], Optional[str]]:
    row = conn.execute(f"SELECT MIN(date), MAX(date) FROM {TABLE}").fetchone()
    return (row[0], row[1]) if row else (None, None)


def _shift_iso(value: str, days: int) -> str:
    from datetime import date, timedelta

    return (date.fromisoformat(value) + timedelta(days=days)).isoformat()


__all__ = [
    "COLUMNS",
    "DEFAULT_DB_PATH",
    "ROOT",
    "SCHEMA_SQL",
    "TABLE",
    "anchor_dates",
    "count_rows",
    "date_range",
    "default_db_path",
    "ensure_schema",
    "fetch_options",
    "fetch_rows",
    "latest_date",
    "open_reader",
    "open_writer",
    "upsert_rows",
]

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
LEDGER_TABLE: str = "agri_ingest_partitions"


class SnapshotError(RuntimeError):
    """A release snapshot is missing its schema and must not be migrated on read."""


DISTRICT_KEY_SEPARATOR: str = "||"
PARTITION_STATUSES: tuple[str, ...] = ("pending", "complete", "partial", "failed", "empty")
COLUMNS: tuple[str, ...] = (
    "date", "state", "district", "market", "commodity", "commodity_key",
    "variety", "grade", "min_price", "max_price", "modal_price",
    "arrivals_qtl", "price_unit", "source",
    "source_commodity", "product_form", "arrival_units", "price_source",
    "arrivals_source", "ingested_at",
)

#: Columns added after the first release. ``ensure_schema`` adds any that are
#: missing so an existing 1.2M-row cache is migrated in place, not rebuilt.
_ADDED_COLUMNS: dict[str, str] = {
    "source_commodity": "TEXT",
    "product_form": "TEXT NOT NULL DEFAULT ''",
    "price_unit": "TEXT NOT NULL DEFAULT ''",
    "arrival_units": "TEXT NOT NULL DEFAULT ''",
    "price_source": "TEXT NOT NULL DEFAULT ''",
    "arrivals_source": "TEXT NOT NULL DEFAULT ''",
    "ingested_at": "TEXT",
}

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
    source_commodity TEXT,
    product_form   TEXT NOT NULL DEFAULT '',
    arrival_units  TEXT NOT NULL DEFAULT '',
    price_source   TEXT NOT NULL DEFAULT '',
    arrivals_source TEXT NOT NULL DEFAULT '',
    ingested_at    TEXT,
    UNIQUE(date, state, district, market, commodity, variety, grade)
);
CREATE INDEX IF NOT EXISTS idx_agri_date ON {TABLE}(date);
CREATE INDEX IF NOT EXISTS idx_agri_commodity_key ON {TABLE}(commodity_key);
CREATE INDEX IF NOT EXISTS idx_agri_key_date ON {TABLE}(commodity_key, date);
CREATE INDEX IF NOT EXISTS idx_agri_state ON {TABLE}(state);
CREATE TABLE IF NOT EXISTS {LEDGER_TABLE} (
    source          TEXT NOT NULL,
    arrival_date    TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    expected_total  INTEGER NULL,
    fetched_rows    INTEGER NULL,
    pages           INTEGER NULL,
    api_updated_at  TEXT NULL,
    run_id          TEXT NULL,
    started_at      TEXT NULL,
    finished_at     TEXT NULL,
    error           TEXT NULL,
    PRIMARY KEY (source, arrival_date)
);
CREATE INDEX IF NOT EXISTS idx_agri_ledger_status ON {LEDGER_TABLE}(status, arrival_date);
"""

# Kept out of SCHEMA_SQL on purpose: ``open_reader`` must not write to a cache
# file. Writers (importer/collector) apply it on their next open, and existing
# caches can be migrated explicitly with ``ensure_geo_index``. A cold
# /api/agri/filters then reads geography metadata from this small covering index
# instead of scanning every price row.
GEO_INDEX_NAME: str = "idx_agri_geo"
GEO_INDEX_SQL: str = (
    f"CREATE INDEX IF NOT EXISTS {GEO_INDEX_NAME} ON {TABLE}(state, district, market)"
)

# Daily rows carry no arrivals; a null must never erase CKAN history. The
# source columns travel with the row so a preserved arrival keeps its origin.
_UPSERT_SQL: str = f"""
INSERT INTO {TABLE} ({', '.join(COLUMNS)})
VALUES ({', '.join('?' for _ in COLUMNS)})
ON CONFLICT(date, state, district, market, commodity, variety, grade) DO UPDATE SET
    commodity_key=COALESCE(excluded.commodity_key, commodity_key),
    min_price=excluded.min_price,
    max_price=excluded.max_price,
    modal_price=excluded.modal_price,
    arrivals_qtl=COALESCE(excluded.arrivals_qtl, arrivals_qtl),
    price_unit=COALESCE(NULLIF(excluded.price_unit, ''), price_unit),
    source=COALESCE(NULLIF(excluded.source, ''), source),
    source_commodity=COALESCE(excluded.source_commodity, source_commodity),
    product_form=COALESCE(NULLIF(excluded.product_form, ''), product_form),
    arrival_units=COALESCE(NULLIF(excluded.arrival_units, ''), arrival_units),
    price_source=COALESCE(NULLIF(excluded.price_source, ''), price_source),
    arrivals_source=CASE
        WHEN excluded.arrivals_qtl IS NOT NULL
        THEN COALESCE(NULLIF(excluded.arrivals_source, ''), NULLIF(excluded.source, ''), arrivals_source)
        ELSE arrivals_source
    END,
    ingested_at=COALESCE(excluded.ingested_at, ingested_at)
"""

_LEDGER_UPSERT_SQL: str = f"""
INSERT INTO {LEDGER_TABLE}
    (source, arrival_date, status, expected_total, fetched_rows, pages,
     api_updated_at, run_id, started_at, finished_at, error)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(source, arrival_date) DO UPDATE SET
    status=excluded.status,
    expected_total=excluded.expected_total,
    fetched_rows=excluded.fetched_rows,
    pages=excluded.pages,
    api_updated_at=excluded.api_updated_at,
    run_id=excluded.run_id,
    started_at=excluded.started_at,
    finished_at=excluded.finished_at,
    error=excluded.error
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
    # The collector, importer and API may overlap; WAL keeps readers from
    # blocking the writer and busy_timeout absorbs the remaining contention.
    if not read_only:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
    else:
        # The metadata scan walks a large index; memory-mapped reads let the OS
        # page cache serve it without copying every page into SQLite's small
        # per-connection cache. This is connection-local, never persisted.
        conn.execute("PRAGMA mmap_size=2147483648")
        conn.execute("PRAGMA query_only=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _migrate_columns(conn: sqlite3.Connection) -> None:
    existing = {row["name"] if isinstance(row, sqlite3.Row) else row[1]
                for row in conn.execute(f"PRAGMA table_info({TABLE})")}
    for name, ddl in _ADDED_COLUMNS.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE {TABLE} ADD COLUMN {name} {ddl}")


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_SQL)
    _migrate_columns(conn)


def ensure_geo_index(conn: sqlite3.Connection) -> None:
    """Apply the geography covering index to an existing cache (one-time migration)."""
    conn.execute(GEO_INDEX_SQL)


def open_writer(path: Optional[str | Path] = None) -> sqlite3.Connection:
    """Open (and initialise) the cache for import/collector writes."""
    conn = _connect(_resolve(path), read_only=False)
    ensure_schema(conn)
    ensure_geo_index(conn)
    return conn


_MIGRATED_PATHS: set[str] = set()


def _ensure_migrated(path: Path) -> None:
    """Apply additive columns to an existing cache once before read-only use."""
    key = str(path.resolve())
    if key in _MIGRATED_PATHS:
        return
    conn = _connect(path, read_only=False)
    try:
        ensure_schema(conn)
    finally:
        conn.close()
    _MIGRATED_PATHS.add(key)


def open_reader(
    path: Optional[str | Path] = None,
    *,
    migrate: bool = True,
) -> Optional[sqlite3.Connection]:
    """Open the cache read-only. ``None`` means "no cache on disk".

    ``migrate=False`` is for release snapshots: it never opens a writer, and a
    DB without the agri table is rejected instead of being created or migrated.
    """
    target = _resolve(path)
    if str(target) != ":memory:" and not target.exists():
        return None
    if str(target) != ":memory:" and migrate:
        _ensure_migrated(target)
    conn = _connect(target, read_only=True)
    try:
        if not migrate:
            table = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
                (TABLE,),
            ).fetchone()
            if table is None:
                raise SnapshotError(f"snapshot has no {TABLE} table")
        conn.execute("SELECT 1 FROM sqlite_master LIMIT 1").fetchone()
    except Exception:
        conn.close()
        raise
    return conn


def open_snapshot_reader(path: Optional[str | Path] = None) -> Optional[sqlite3.Connection]:
    """Read a release snapshot without migrations or any writes."""
    return open_reader(path, migrate=False)


_TEXT_DEFAULTS: dict[str, str] = {
    "state": "", "district": "", "market": "", "variety": "", "grade": "",
    "price_unit": "", "source": "", "product_form": "", "arrival_units": "",
    "price_source": "", "arrivals_source": "",
}


def _column_value(row: dict[str, Any], column: str) -> Any:
    value = row.get(column)
    if value is None and column in _TEXT_DEFAULTS:
        return _TEXT_DEFAULTS[column]
    return value


def upsert_rows(conn: sqlite3.Connection, rows: Iterable[dict[str, Any]]) -> int:
    """Insert or refresh rows keyed by (date, geography, commodity, variety, grade).

    A null ``arrivals_qtl`` in an incoming daily row leaves the stored value
    untouched, so a CKAN seed arrival survives the official feed's arrival-less
    rows. Price fields are still replaced by the newest observation.
    """
    batch = [
        tuple(_column_value(row, column) for column in COLUMNS)
        for row in rows
    ]
    if not batch:
        return 0
    with conn:
        conn.executemany(_UPSERT_SQL, batch)
    return len(batch)


def get_partition(
    conn: sqlite3.Connection,
    source: str,
    arrival_date: str,
) -> Optional[dict[str, Any]]:
    """Ingestion ledger row for one source/date, or ``None`` when never attempted."""
    row = conn.execute(
        f"SELECT * FROM {LEDGER_TABLE} WHERE source = ? AND arrival_date = ?",
        (source, arrival_date),
    ).fetchone()
    return dict(row) if row else None


def upsert_partition(
    conn: sqlite3.Connection,
    *,
    source: str,
    arrival_date: str,
    status: str,
    expected_total: Optional[int] = None,
    fetched_rows: Optional[int] = None,
    pages: Optional[int] = None,
    api_updated_at: Optional[str] = None,
    run_id: Optional[str] = None,
    started_at: Optional[str] = None,
    finished_at: Optional[str] = None,
    error: Optional[str] = None,
) -> None:
    """Record the outcome of one collection attempt.

    Only ``status='complete'`` is skippable; ``partial``/``failed``/``empty``
    stay retryable so a short day can never masquerade as a finished day.
    """
    if status not in PARTITION_STATUSES:
        raise ValueError(f"unknown partition status: {status}")
    with conn:
        conn.execute(
            _LEDGER_UPSERT_SQL,
            (source, arrival_date, status, expected_total, fetched_rows, pages,
             api_updated_at, run_id, started_at, finished_at, error),
        )


def fetch_partitions(
    conn: sqlite3.Connection,
    *,
    source: Optional[str] = None,
    statuses: Optional[Iterable[str]] = None,
    limit: Optional[int] = None,
) -> list[dict[str, Any]]:
    clauses: list[str] = []
    params: list[Any] = []
    if source:
        clauses.append("source = ?")
        params.append(source)
    if statuses:
        items = list(statuses)
        clauses.append(f"status IN ({', '.join('?' for _ in items)})")
        params.extend(items)
    sql = f"SELECT * FROM {LEDGER_TABLE}"
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY arrival_date"
    if limit is not None:
        sql += " LIMIT ?"
        params.append(limit)
    return [dict(row) for row in conn.execute(sql, params)]


def fetch_rows(
    conn: sqlite3.Connection,
    *,
    commodity_names: Optional[Iterable[str]] = None,
    commodity_keys: Optional[Iterable[str]] = None,
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
    add("commodity_key", commodity_keys or ())
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
    commodity_keys: Optional[Iterable[str]] = None,
    states: Optional[Iterable[str]] = None,
    districts: Optional[Iterable[str]] = None,
    markets: Optional[Iterable[str]] = None,
) -> Optional[str]:
    """MAX(date) under the same filters the prices endpoint applies."""
    clauses: list[str] = []
    params: list[Any] = []
    for column, values in (
        ("commodity", commodity_names), ("commodity_key", commodity_keys),
        ("state", states), ("district", districts), ("market", markets),
    ):
        items = list(values or ())
        if items:
            clauses.append(f"{column} IN ({', '.join('?' for _ in items)})")
            params.extend(items)
    sql = f"SELECT MAX(date) FROM {TABLE}"
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    return conn.execute(sql, params).fetchone()[0]


def latest_date_per_key(
    conn: sqlite3.Connection,
    keys: Iterable[str],
    *,
    states: Optional[Iterable[str]] = None,
    districts: Optional[Iterable[str]] = None,
    markets: Optional[Iterable[str]] = None,
) -> dict[str, Optional[str]]:
    """MAX(date) per commodity key, not one global as-of for every series.

    A partial or absent day must leave an individual key on its own latest
    date instead of advancing it to another commodity's newest row.
    """
    selected = list(keys)
    if not selected:
        return {}
    clauses = ["commodity_key = ?"]
    common_params: list[Any] = []
    for column, values in (
        ("state", states), ("district", districts), ("market", markets),
    ):
        items = list(values or ())
        if items:
            clauses.append(f"{column} IN ({', '.join('?' for _ in items)})")
            common_params.extend(items)
    # A grouped MAX walks every row of every key. The key/date index already
    # ends at each key's newest date, so one seek per key answers the same
    # question (~8s -> ~0.1s over the 1.5M-row cache).
    sql = f"SELECT MAX(date) FROM {TABLE} WHERE {' AND '.join(clauses)}"
    return {
        key: conn.execute(sql, [key, *common_params]).fetchone()[0]
        for key in selected
    }


_OPTIONS_CACHE: dict[tuple[Any, ...], dict[str, Any]] = {}
_GEOGRAPHY_CACHE: dict[tuple[Any, ...], dict[str, Any]] = {}
# Both option lists and the geography cascade derive from the same distinct
# (state, district, market) rows. Scanning the 1.5M-row cache once here avoids
# paying for three additional full-table DISTINCT queries in ``/filters``.
_META_CACHE: dict[tuple[Any, ...], tuple[Any, ...]] = {}


def _stat_parts(path: str) -> tuple[int, int]:
    try:
        stat = os.stat(path)
    except OSError:
        return (0, 0)
    return (stat.st_mtime_ns, stat.st_size)


def cache_identity(conn: sqlite3.Connection) -> Optional[tuple[str, int, int, int, int]]:
    """File identity for mtime/size-keyed caches; ``None`` for non-file DBs.

    In WAL mode the committed rows usually live in ``-wal`` until a checkpoint,
    so the main file alone can look unchanged after a write.
    """
    path_row = conn.execute("PRAGMA database_list").fetchone()
    path = str(path_row[2] or "") if path_row else ""
    if not path:
        return None
    main = _stat_parts(path)
    if main == (0, 0) and not os.path.exists(path):
        return None
    wal = _stat_parts(f"{path}-wal")
    return (path, *main, *wal)


def _geo_scan_sql(conn: sqlite3.Connection) -> str:
    """Pick the cheapest index that covers the three geography columns.

    DISTINCT collapses duplicate tuples inside SQLite: one pass over a covering
    index returns a few thousand rows instead of materialising every price row
    in Python. Indexes whose leading columns are exactly the geography tuple
    need no temporary B-tree and are preferred.
    """
    candidates: list[tuple[int, str]] = []
    for info in conn.execute(f"PRAGMA index_list({TABLE})"):
        name = str(info["name"] if isinstance(info, sqlite3.Row) else info[1])
        partial = info["partial"] if isinstance(info, sqlite3.Row) else info[4]
        if partial:
            continue
        quoted = '"' + name.replace('"', '""') + '"'
        cols = [str(col[2]) for col in conn.execute(f"PRAGMA index_info({quoted})")]
        if not {"state", "district", "market"} <= set(cols):
            continue
        rank = 0 if cols[:3] == ["state", "district", "market"] else 1
        candidates.append((rank, name))
    if not candidates:
        return f"SELECT state, district, market FROM {TABLE}"
    _, name = min(candidates)
    quoted = '"' + name.replace('"', '""') + '"'
    return f"SELECT DISTINCT state, district, market FROM {TABLE} INDEXED BY {quoted}"


def _geo_meta(
    conn: sqlite3.Connection, cache_key: Optional[tuple[Any, ...]]
) -> tuple[Any, ...]:
    """Sorted option lists and cascades from one pass over the geography rows."""
    if cache_key is not None:
        cached = _META_CACHE.get(cache_key)
        if cached is not None:
            return cached
    states: set[str] = set()
    districts: set[str] = set()
    markets: set[str] = set()
    state_districts: dict[str, set[str]] = {}
    district_markets: dict[str, set[str]] = {}
    for state, district, market in conn.execute(_geo_scan_sql(conn)):
        if state:
            states.add(state)
        if district:
            districts.add(district)
        if market:
            markets.add(market)
        if state and district and market:
            state_districts.setdefault(state, set()).add(district)
            district_markets.setdefault(
                f"{state}{DISTRICT_KEY_SEPARATOR}{district}", set()
            ).add(market)
    meta = (
        sorted(states), sorted(districts), sorted(markets),
        {state: sorted(values) for state, values in state_districts.items()},
        {key: sorted(values) for key, values in district_markets.items()},
    )
    if cache_key is not None:
        if len(_META_CACHE) >= 4:
            _META_CACHE.clear()
        _META_CACHE[cache_key] = meta
    return meta


def fetch_options(conn: sqlite3.Connection) -> dict[str, Any]:
    """Filter metadata, cached until the cache file changes.

    ``SELECT DISTINCT`` over 1.5M rows cost ~22s cold on every request; the
    option lists only change when an import/collector writes the DB.
    """
    cache_key = cache_identity(conn)
    if cache_key is not None:
        cached = _OPTIONS_CACHE.get(cache_key)
        if cached is not None:
            return dict(cached)
    states, districts, markets, _, _ = _geo_meta(conn, cache_key)
    as_of = conn.execute(f"SELECT MAX(date) FROM {TABLE}").fetchone()[0]
    result = {
        "as_of": as_of,
        # Fresh lists: callers must not be able to mutate the cached metadata.
        "states": list(states), "districts": list(districts), "markets": list(markets),
    }
    if cache_key is not None:
        if len(_OPTIONS_CACHE) >= 4:
            _OPTIONS_CACHE.clear()
        _OPTIONS_CACHE[cache_key] = dict(result)
    return result


def fetch_geography(conn: sqlite3.Connection) -> dict[str, Any]:
    """State→district and district→market cascades, cached per DB identity.

    Kept out of :func:`fetch_options` so the ``/prices`` hot path does not pay
    for the geography scan at all; ``/filters`` reuses the same one-pass scan
    that built the option lists.
    """
    cache_key = cache_identity(conn)
    if cache_key is not None:
        cached = _GEOGRAPHY_CACHE.get(cache_key)
        if cached is not None:
            return dict(cached)
    _, _, _, state_districts, district_markets = _geo_meta(conn, cache_key)
    result = {
        "state_districts": {state: list(values) for state, values in state_districts.items()},
        "district_markets": {key: list(values) for key, values in district_markets.items()},
    }
    if cache_key is not None:
        if len(_GEOGRAPHY_CACHE) >= 4:
            _GEOGRAPHY_CACHE.clear()
        _GEOGRAPHY_CACHE[cache_key] = dict(result)
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
    "DISTRICT_KEY_SEPARATOR",
    "GEO_INDEX_NAME",
    "GEO_INDEX_SQL",
    "LEDGER_TABLE",
    "PARTITION_STATUSES",
    "ROOT",
    "SCHEMA_SQL",
    "SnapshotError",
    "TABLE",
    "anchor_dates",
    "cache_identity",
    "count_rows",
    "date_range",
    "default_db_path",
    "ensure_geo_index",
    "ensure_schema",
    "fetch_options",
    "fetch_geography",
    "fetch_partitions",
    "fetch_rows",
    "get_partition",
    "latest_date",
    "latest_date_per_key",
    "open_reader",
    "open_snapshot_reader",
    "open_writer",
    "upsert_partition",
    "upsert_rows",
]

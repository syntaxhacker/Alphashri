#!/usr/bin/env python3
"""Dedicated SQLite store for the edge-detection pipeline.

A DEDICATED database under `unusual_whales/data/edge.db` — deliberately NOT the
app's `db/alphashri.db` (accounts/bots/trades) and NOT the alert history in
`data/alerts.db`. It holds three things:

    bars      cached OHLCV (1-minute *and* daily; daily rows use a `T00:00:00Z`
              timestamp marker so they never collide with intraday bars)
    outcomes  one scored alert+horizon once price has moved far enough to score
    edge_stats pre-aggregated bucket stats (scope, bucket, horizon)

Everything is best-effort: a broken DB never raises into a request path.

Override the path with `UW_EDGE_DB` (used by tests).
"""
from __future__ import annotations

import os
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
_DEFAULT = _ROOT / "data" / "edge.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS bars (
    ticker TEXT NOT NULL,
    ts     TEXT NOT NULL,
    o REAL, h REAL, l REAL, c REAL, v REAL,
    PRIMARY KEY (ticker, ts)
);
CREATE INDEX IF NOT EXISTS idx_bars_ticker_ts ON bars(ticker, ts);

CREATE TABLE IF NOT EXISTS outcomes (
    alert_id     TEXT NOT NULL,
    horizon      TEXT NOT NULL,
    entry_ts     TEXT,
    entry_px     REAL,
    exit_ts      TEXT,
    exit_px      REAL,
    ret          REAL,
    mfe          REAL,
    mae          REAL,
    dir          INTEGER,
    baseline_ret REAL,
    excess       REAL,
    resolved_at  TEXT,
    PRIMARY KEY (alert_id, horizon)
);
CREATE INDEX IF NOT EXISTS idx_outcomes_horizon ON outcomes(horizon);

CREATE TABLE IF NOT EXISTS edge_stats (
    scope      TEXT NOT NULL,
    bucket     TEXT NOT NULL,
    horizon    TEXT NOT NULL,
    n          INTEGER,   -- legacy alias of n_raw (kept for old dashboard clients)
    n_raw      INTEGER,   -- raw outcomes (before independence dedupe)
    n_ind      INTEGER,   -- independent observations = distinct (ticker, minute, dir)
    distinct_tickers  INTEGER,
    distinct_sessions INTEGER,
    win_rate   REAL,      -- FRACTION 0..1
    avg_ret    REAL,      -- FRACTION (not %)
    avg_excess REAL,      -- FRACTION (not %)
    tstat      REAL,
    low_n      INTEGER,   -- 1 when n_ind < 20 or tickers < 5 or sessions < 2
    updated_at TEXT,
    PRIMARY KEY (scope, bucket, horizon)
);
"""

# Columns added after the first release of `edge_stats`; ALTERed in on connect so
# an existing edge.db picks them up without a full rebuild.
_STAT_ALT_COLS = (
    ("n_raw", "INTEGER"),
    ("n_ind", "INTEGER"),
    ("distinct_tickers", "INTEGER"),
    ("distinct_sessions", "INTEGER"),
    ("low_n", "INTEGER"),
)

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None
_conn_path: str | None = None


def db_path() -> Path:
    return Path(os.environ.get("UW_EDGE_DB") or _DEFAULT)


def _connect() -> sqlite3.Connection:
    global _conn, _conn_path
    p = db_path()
    if _conn is not None and _conn_path == str(p):
        return _conn
    p.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(p), check_same_thread=False, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA synchronous=NORMAL")
    c.executescript(_SCHEMA)
    # add any columns missing from a pre-existing table
    have = {r["name"] for r in c.execute("PRAGMA table_info(edge_stats)")}
    for name, typ in _STAT_ALT_COLS:
        if name not in have:
            try:
                c.execute(f"ALTER TABLE edge_stats ADD COLUMN {name} {typ}")
            except sqlite3.OperationalError:
                pass
    c.commit()
    _conn, _conn_path = c, str(p)
    return c


def _reset() -> None:
    """Drop the cached connection (tests / path changes)."""
    global _conn, _conn_path
    with _lock:
        try:
            if _conn is not None:
                _conn.close()
        except Exception:  # noqa: BLE001
            pass
        _conn, _conn_path = None, None


def init() -> bool:
    """Create the schema if needed. Returns True on success."""
    try:
        with _lock:
            _connect()
        return True
    except Exception:  # noqa: BLE001
        return False


def _f(v):
    """Coerce to a finite float or None."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and abs(f) != float("inf") else None


# --------------------------------------------------------------------- bars
_BAR_COLS = "ticker, ts, o, h, l, c, v"


def put_bars(rows) -> int:
    """Insert-or-replace OHLCV rows. Returns how many were written.

    Each row is `{ticker, ts, o/h/l/c/v}`. `ts` is an ISO-8601 string; daily
    bars use `YYYY-MM-DDT00:00:00Z`. Garbage rows are skipped.
    """
    clean = []
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        ticker = str(r.get("ticker") or "").upper().strip()
        ts = str(r.get("ts") or "").strip()
        if not ticker or not ts:
            continue
        clean.append((ticker, ts, _f(r.get("o")), _f(r.get("h")), _f(r.get("l")), _f(r.get("c")), _f(r.get("v"))))
    if not clean:
        return 0
    try:
        with _lock:
            c = _connect()
            c.executemany(
                f"INSERT OR REPLACE INTO bars ({_BAR_COLS}) VALUES (?,?,?,?,?,?,?)", clean
            )
            c.commit()
        return len(clean)
    except Exception:  # noqa: BLE001
        return 0


def get_bars(ticker: str, since: str | None = None, until: str | None = None) -> list:
    """Return cached bars for a ticker, oldest first. Empty list on error."""
    ticker = str(ticker or "").upper().strip()
    if not ticker:
        return []
    clauses, params = ["ticker = ?"], [ticker]
    if since:
        clauses.append("ts >= ?")
        params.append(str(since))
    if until:
        clauses.append("ts <= ?")
        params.append(str(until))
    sql = f"SELECT ts, o, h, l, c, v FROM bars WHERE {' AND '.join(clauses)} ORDER BY ts ASC"
    try:
        with _lock:
            c = _connect()
            return [dict(r) for r in c.execute(sql, params).fetchall()]
    except Exception:  # noqa: BLE001
        return []


def bars_span(ticker: str, daily: bool | None = None) -> dict | None:
    """`{min, max, n}` for a ticker, or None when empty.

    `daily=True/False` filters to midnight-marked (`T00:00:00Z`) / intraday bars.
    """
    ticker = str(ticker or "").upper().strip()
    if not ticker:
        return None
    clauses, params = ["ticker = ?"], [ticker]
    if daily is True:
        clauses.append("ts LIKE '%T00:00:00Z'")
    elif daily is False:
        clauses.append("ts NOT LIKE '%T00:00:00Z'")
    sql = f"SELECT MIN(ts) mn, MAX(ts) mx, COUNT(*) n FROM bars WHERE {' AND '.join(clauses)}"
    try:
        with _lock:
            c = _connect()
            row = c.execute(sql, params).fetchone()
        if not row or not row["n"]:
            return None
        return {"min": row["mn"], "max": row["mx"], "n": row["n"]}
    except Exception:  # noqa: BLE001
        return None


# ----------------------------------------------------------------- outcomes
_OUT_COLS = (
    "alert_id, horizon, entry_ts, entry_px, exit_ts, exit_px, ret, mfe, mae, "
    "dir, baseline_ret, excess, resolved_at"
)
_OUT_PH = ",".join(["?"] * 13)


def upsert_outcomes(rows) -> int:
    """Insert-or-replace scored outcomes. Returns how many were written."""
    clean = []
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        aid = str(r.get("alert_id") or "").strip()
        h = str(r.get("horizon") or "").strip()
        if not aid or not h:
            continue
        try:
            d = int(r.get("dir"))
        except (TypeError, ValueError):
            d = 0
        clean.append(
            (
                aid,
                h,
                r.get("entry_ts"),
                _f(r.get("entry_px")),
                r.get("exit_ts"),
                _f(r.get("exit_px")),
                _f(r.get("ret")),
                _f(r.get("mfe")),
                _f(r.get("mae")),
                d,
                _f(r.get("baseline_ret")),
                _f(r.get("excess")),
                r.get("resolved_at"),
            )
        )
    if not clean:
        return 0
    try:
        with _lock:
            c = _connect()
            c.executemany(f"INSERT OR REPLACE INTO outcomes ({_OUT_COLS}) VALUES ({_OUT_PH})", clean)
            c.commit()
        return len(clean)
    except Exception:  # noqa: BLE001
        return 0


def get_resolved_ids() -> set:
    """Set of `(alert_id, horizon)` pairs already scored."""
    try:
        with _lock:
            c = _connect()
            return {(r["alert_id"], r["horizon"]) for r in c.execute("SELECT alert_id, horizon FROM outcomes")}
    except Exception:  # noqa: BLE001
        return set()


def get_outcomes() -> list:
    """All scored outcomes as dicts (used by the stats builder)."""
    try:
        with _lock:
            c = _connect()
            cols = _OUT_COLS + ","
            return [dict(r) for r in c.execute(
                "SELECT alert_id, horizon, entry_ts, entry_px, exit_ts, exit_px, ret, mfe, mae, "
                "dir, baseline_ret, excess, resolved_at FROM outcomes"
            )]
    except Exception:  # noqa: BLE001
        return []


def outcome_counts() -> dict:
    """`{total, alerts, horizons:{h:n}}` — cheap sample-size metadata."""
    try:
        with _lock:
            c = _connect()
            total = c.execute("SELECT COUNT(*) FROM outcomes").fetchone()[0]
            alerts = c.execute("SELECT COUNT(DISTINCT alert_id) FROM outcomes").fetchone()[0]
            by_h = {r["horizon"]: r["n"] for r in c.execute(
                "SELECT horizon, COUNT(*) n FROM outcomes GROUP BY horizon"
            )}
        return {"total": total, "alerts": alerts, "horizons": by_h}
    except Exception:  # noqa: BLE001
        return {"total": 0, "alerts": 0, "horizons": {}}


def clear_outcomes() -> int:
    """Delete every scored outcome (used by `edge_resolver.py --reset`).

    Returns how many rows were removed. Never raises.
    """
    try:
        with _lock:
            c = _connect()
            n = c.execute("SELECT COUNT(*) FROM outcomes").fetchone()[0]
            c.execute("DELETE FROM outcomes")
            c.commit()
        return n
    except Exception:  # noqa: BLE001
        return 0


# -------------------------------------------------------------------- stats
def clear_stats() -> int:
    try:
        with _lock:
            c = _connect()
            n = c.execute("SELECT COUNT(*) FROM edge_stats").fetchone()[0]
            c.execute("DELETE FROM edge_stats")
            c.commit()
        return n
    except Exception:  # noqa: BLE001
        return 0


def save_stats(rows) -> int:
    """Insert-or-replace aggregate stat rows. Returns how many were written.

    Accepts either the new fields (`n_raw`, `n_ind`, `distinct_tickers`,
    `distinct_sessions`, `low_n`) or a legacy `n`; `n` is always stored as an
    alias of `n_raw` so old clients keep working.
    """
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    clean = []
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        scope = str(r.get("scope") or "").strip()
        bucket = str(r.get("bucket") or "").strip()
        h = str(r.get("horizon") or "").strip()
        if not scope or not bucket or not h:
            continue
        n_raw = int(_f(r.get("n_raw")) or _f(r.get("n")) or 0)
        n_ind = int(_f(r.get("n_ind")) or 0)
        dt = int(_f(r.get("distinct_tickers")) or 0)
        ds = int(_f(r.get("distinct_sessions")) or 0)
        low = r.get("low_n")
        low = 1 if low is None else (1 if low else 0)
        clean.append(
            (
                scope,
                bucket,
                h,
                n_raw,          # legacy `n`
                n_raw,
                n_ind,
                dt,
                ds,
                _f(r.get("win_rate")),
                _f(r.get("avg_ret")),
                _f(r.get("avg_excess")),
                _f(r.get("tstat")),
                low,
                r.get("updated_at") or now,
            )
        )
    if not clean:
        return 0
    try:
        with _lock:
            c = _connect()
            c.executemany(
                "INSERT OR REPLACE INTO edge_stats "
                "(scope, bucket, horizon, n, n_raw, n_ind, distinct_tickers, distinct_sessions, "
                "win_rate, avg_ret, avg_excess, tstat, low_n, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                clean,
            )
            c.commit()
        return len(clean)
    except Exception:  # noqa: BLE001
        return 0


def query_stats(scope: str | None = None, horizon: str | None = None, min_n: int = 0) -> list:
    """Return stat rows (filtered), ordered by sample size, then scope/bucket.

    `min_n` filters on the legacy `n` column (= `n_raw`).
    """
    clauses, params = [], []
    if scope:
        clauses.append("scope = ?")
        params.append(str(scope))
    if horizon:
        clauses.append("horizon = ?")
        params.append(str(horizon))
    if min_n:
        clauses.append("n >= ?")
        params.append(int(min_n))
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    sql = (
        "SELECT scope, bucket, horizon, n, n_raw, n_ind, distinct_tickers, distinct_sessions, "
        "win_rate, avg_ret, avg_excess, tstat, low_n, updated_at "
        f"FROM edge_stats{where} ORDER BY n_ind DESC, n_raw DESC, scope ASC, bucket ASC, horizon ASC"
    )
    try:
        with _lock:
            c = _connect()
            return [dict(r) for r in c.execute(sql, params).fetchall()]
    except Exception:  # noqa: BLE001
        return []


def stats_meta() -> dict:
    """`{rows, updated_at, scopes}` for the edge header."""
    try:
        with _lock:
            c = _connect()
            rows = c.execute("SELECT COUNT(*) FROM edge_stats").fetchone()[0]
            updated = c.execute("SELECT MAX(updated_at) FROM edge_stats").fetchone()[0]
            scopes = [r["scope"] for r in c.execute("SELECT DISTINCT scope FROM edge_stats ORDER BY scope")]
        return {"rows": rows, "updated_at": updated, "scopes": scopes}
    except Exception:  # noqa: BLE001
        return {"rows": 0, "updated_at": None, "scopes": []}


if __name__ == "__main__":
    import json

    init()
    print(json.dumps(
        {
            "db": str(db_path()),
            "outcomes": outcome_counts(),
            "stats": stats_meta(),
        },
        indent=2,
    ))

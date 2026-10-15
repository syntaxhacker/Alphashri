#!/usr/bin/env python3
"""SQLite persistence for dashboard alerts.

A DEDICATED database under `unusual_whales/data/alerts.db` — deliberately NOT the
app's `db/alphashri.db` (which holds accounts/bots/trades). Every builder (live
flow/unusual/dark-pool and daily OI) upserts into it, so the alert history
survives page reloads and feed rotation. All operations are best-effort and never
raise into the request path.

Override the path with `UW_ALERTS_DB` (used by tests).
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
_DEFAULT = _ROOT / "data" / "alerts.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS alerts (
    id          TEXT PRIMARY KEY,
    source      TEXT,
    kind        TEXT,
    ticker      TEXT,
    asset_class TEXT,
    type        TEXT,
    strike      REAL,
    expiry      TEXT,
    premium     REAL,
    size        INTEGER,
    volume      INTEGER,
    oi          INTEGER,
    vol_oi      REAL,
    sweep       INTEGER,
    side        TEXT,
    rule        TEXT,
    severity    TEXT,
    event_ts    TEXT,
    first_seen  TEXT,
    payload     TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_event  ON alerts(event_ts DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_ticker ON alerts(ticker);
CREATE INDEX IF NOT EXISTS idx_alerts_kind   ON alerts(kind);
"""

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None
_conn_path: str | None = None


def db_path() -> Path:
    return Path(os.environ.get("UW_ALERTS_DB") or _DEFAULT)


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
    # one-time backfill: early OI rows were stored before `kind` was set
    c.execute("UPDATE alerts SET kind='oi' WHERE (kind IS NULL OR kind='') AND source='oi'")
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


def _num(v):
    try:
        f = float(v)
        return f if f == f and abs(f) != float("inf") else None
    except (TypeError, ValueError):
        return None


def _row(a: dict, source: str, now: str) -> tuple:
    return (
        str(a.get("id")),
        source,
        a.get("kind") or ("oi" if source == "oi" else None),
        (a.get("ticker") or "").upper(),
        a.get("asset_class"),
        a.get("type"),
        _num(a.get("strike")),
        a.get("expiry") or None,
        _num(a.get("premium")),
        int(_num(a.get("size")) or 0),
        int(_num(a.get("volume")) or 0),
        int(_num(a.get("oi")) or 0),
        _num(a.get("vol_oi")),
        1 if a.get("sweep") else 0,
        a.get("side"),
        a.get("rule") or a.get("note"),
        a.get("severity"),
        str(a.get("created_at") or a.get("session") or ""),
        now,
        json.dumps(a, default=str),
    )


_COLS = ("id, source, kind, ticker, asset_class, type, strike, expiry, premium, size, "
         "volume, oi, vol_oi, sweep, side, rule, severity, event_ts, first_seen, payload")
_PH = ",".join(["?"] * 20)


def upsert(rows, source: str = "live") -> int:
    """Insert-or-ignore alerts; returns how many were actually new."""
    rows = [r for r in (rows or []) if isinstance(r, dict) and r.get("id")]
    if not rows:
        return 0
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    try:
        with _lock:
            c = _connect()
            n = 0
            for r in rows:
                cur = c.execute(f"INSERT OR IGNORE INTO alerts ({_COLS}) VALUES ({_PH})", _row(r, source, now))
                if cur.rowcount and cur.rowcount > 0:
                    n += 1
            c.commit()
    except Exception:  # noqa: BLE001
        return 0
    _maybe_prune()
    return n


_last_prune = 0.0


def _maybe_prune(interval: int = 3600, days: int = 30) -> None:
    """Throttled retention prune (runs at most once an hour)."""
    global _last_prune
    now = time.time()
    if now - _last_prune < interval:
        return
    _last_prune = now
    prune(days)


def query(kind=None, ticker=None, asset_class=None, since=None, q=None, limit=200, offset=0) -> dict:
    clauses, params = [], []
    if kind:
        clauses.append("kind = ?")
        params.append(kind)
    if asset_class:
        clauses.append("asset_class = ?")
        params.append(asset_class)
    if ticker:
        clauses.append("ticker = ?")
        params.append(str(ticker).upper())
    if since:
        clauses.append("event_ts >= ?")
        params.append(since)
    if q:
        clauses.append("(ticker LIKE ? OR rule LIKE ? OR side LIKE ?)")
        like = f"%{q.upper()}%"
        params += [like, like, like]
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    limit = max(1, min(int(limit or 200), 1000))
    try:
        with _lock:
            c = _connect()
            total = c.execute(f"SELECT COUNT(*) FROM alerts{where}", params).fetchone()[0]
            rows = c.execute(
                f"SELECT id,source,kind,ticker,asset_class,type,strike,expiry,premium,size,volume,oi,vol_oi,"
                f"sweep,side,rule,severity,event_ts,first_seen FROM alerts{where} "
                f"ORDER BY event_ts DESC, premium DESC LIMIT ? OFFSET ?",
                params + [limit, max(0, int(offset or 0))],
            ).fetchall()
        return {"total": total, "rows": [dict(r) for r in rows]}
    except Exception:  # noqa: BLE001
        return {"total": 0, "rows": []}


def stats() -> dict:
    try:
        with _lock:
            c = _connect()
            total = c.execute("SELECT COUNT(*) FROM alerts").fetchone()[0]
            by_kind = {r["kind"]: r["n"] for r in c.execute("SELECT kind, COUNT(*) n FROM alerts GROUP BY kind")}
            by_class = {r["asset_class"]: r["n"] for r in c.execute("SELECT asset_class, COUNT(*) n FROM alerts GROUP BY asset_class")}
            latest = c.execute("SELECT MAX(first_seen) FROM alerts").fetchone()[0]
            tickers = c.execute("SELECT COUNT(DISTINCT ticker) FROM alerts").fetchone()[0]
        return {"total": total, "by_kind": by_kind, "by_class": by_class, "tickers": tickers, "latest": latest, "db": str(db_path())}
    except Exception:  # noqa: BLE001
        return {"total": 0, "by_kind": {}, "by_class": {}, "tickers": 0, "latest": None, "db": str(db_path())}


def prune(days: int = 30) -> int:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max(1, int(days)))).isoformat(timespec="seconds")
    try:
        with _lock:
            c = _connect()
            cur = c.execute("DELETE FROM alerts WHERE first_seen < ?", (cutoff,))
            c.commit()
            return cur.rowcount or 0
    except Exception:  # noqa: BLE001
        return 0


if __name__ == "__main__":
    print(json.dumps(stats(), indent=2))

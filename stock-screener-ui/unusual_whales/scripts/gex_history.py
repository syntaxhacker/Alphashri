#!/usr/bin/env python3
"""Daily GEX/OI snapshot per (ticker, date, expiry, strike).

The GEX heatmap shows the *current* strike x expiry dealer-exposure matrix but
has no memory, so it cannot render a "% change vs prior session" column. This
module persists one row per matrix cell per ET day. The UW GEX/OI data updates
roughly once a day (~06:45 ET), so a single snapshot per day is enough.

Captures are lazy (on request) and idempotent: the primary key is
``(ticker, date, expiry, strike)`` so re-capturing the same day is a no-op
upsert. When a second day of data exists, ``changes()`` yields a real percent
change per cell.

A DEDICATED database under ``unusual_whales/data/gex.db`` — deliberately NOT
the app's ``db/alphashri.db`` (accounts/bots/trades). Override the path with
``UW_GEX_DB`` (used by tests). All operations are best-effort and never raise
into the request path.

Usage:
    python scripts/gex_history.py MU
"""
from __future__ import annotations

import os
import sqlite3
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

_ROOT = _SCRIPTS.parent
_DEFAULT = _ROOT / "data" / "gex.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS gex_snapshots (
    ticker      TEXT NOT NULL,
    date        TEXT NOT NULL,
    expiry      TEXT NOT NULL,
    strike      REAL NOT NULL,
    gex         REAL,
    delta       REAL,
    charm       REAL,
    vanna       REAL,
    captured_at TEXT,
    PRIMARY KEY (ticker, date, expiry, strike)
);
CREATE INDEX IF NOT EXISTS idx_gex_snapshots_ticker_date ON gex_snapshots(ticker, date DESC);
"""

_METRICS = ("gex", "delta", "charm", "vanna")
_MAX_CELLS = 20000   # bound on rows written per capture
_MAX_DAYS = 60       # cap on the history/changes window

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None
_conn_path: str | None = None

# (ticker, date) pairs already captured in this process — avoids refetching.
_captured: set[tuple[str, str]] = set()


def db_path() -> Path:
    """Active SQLite path (`UW_GEX_DB` override, else `data/gex.db`)."""
    return Path(os.environ.get("UW_GEX_DB") or _DEFAULT)


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
    c.commit()
    _conn, _conn_path = c, str(p)
    return c


def _reset() -> None:
    """Drop the cached connection + capture flags (tests / path changes)."""
    global _conn, _conn_path
    with _lock:
        try:
            if _conn is not None:
                _conn.close()
        except Exception:  # noqa: BLE001
            pass
        _conn, _conn_path = None, None
        _captured.clear()


def clear_cache() -> None:
    """Forget the 'already captured today' flags so the next request refetches."""
    with _lock:
        _captured.clear()


def _fnum(v, default: float | None = None):
    """Coerce to a finite float; fall back to `default` (never raises)."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return f if f == f and abs(f) != float("inf") else default


def et_date() -> str:
    """Today's US market (ET) calendar date as YYYY-MM-DD."""
    try:
        import market_status  # noqa: PLC0415

        return market_status.now_et().date().isoformat()
    except Exception:  # noqa: BLE001
        return datetime.now(timezone.utc).date().isoformat()


def capture(ticker: str, date: str | None = None) -> int:
    """Capture a GEX matrix snapshot; upsert one row per cell.

    Idempotent (INSERT OR REPLACE on the primary key) and bounded. Returns the
    number of cells written (0 on failure / no data). Never raises. Callers may
    override `date` (used by tests to seed a prior session).
    """
    ticker = str(ticker or "").upper().strip()
    if not ticker:
        return 0
    date = date or et_date()
    key = (ticker, date)
    with _lock:
        if key in _captured:
            return 0  # already captured today in this process
    try:
        import symbol_data  # noqa: PLC0415

        matrix = symbol_data._build_gexmatrix(ticker)
    except Exception:  # noqa: BLE001
        return 0
    cells = (matrix or {}).get("cells") or []
    if not cells:
        return 0

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows: list[tuple] = []
    for cell in cells[:_MAX_CELLS]:
        if not isinstance(cell, dict):
            continue
        exp = str(cell.get("e") or "")[:10]
        strike = _fnum(cell.get("k"))
        if not exp or strike is None:
            continue
        rows.append(
            (
                ticker,
                date,
                exp,
                strike,
                _fnum(cell.get("gex")),
                _fnum(cell.get("delta")),
                _fnum(cell.get("charm")),
                _fnum(cell.get("vanna")),
                now,
            )
        )
    if not rows:
        return 0
    try:
        with _lock:
            c = _connect()
            c.executemany(
                "INSERT OR REPLACE INTO gex_snapshots "
                "(ticker, date, expiry, strike, gex, delta, charm, vanna, captured_at) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                rows,
            )
            c.commit()
            _captured.add(key)
        return len(rows)
    except Exception:  # noqa: BLE001
        return 0


def history(ticker: str, days: int = 10) -> list:
    """Snapshot rows for the last `days` distinct dates (newest date first)."""
    ticker = str(ticker or "").upper().strip()
    if not ticker:
        return []
    days = max(1, min(int(_fnum(days, 10) or 10), _MAX_DAYS))
    try:
        with _lock:
            c = _connect()
            dates = [
                r["date"]
                for r in c.execute(
                    "SELECT DISTINCT date FROM gex_snapshots WHERE ticker = ? ORDER BY date DESC LIMIT ?",
                    (ticker, days),
                ).fetchall()
            ]
            if not dates:
                return []
            placeholders = ",".join(["?"] * len(dates))
            rows = c.execute(
                "SELECT ticker, date, expiry, strike, gex, delta, charm, vanna, captured_at "
                f"FROM gex_snapshots WHERE ticker = ? AND date IN ({placeholders}) "
                "ORDER BY date DESC, expiry ASC, strike DESC",
                [ticker] + dates,
            ).fetchall()
        return [dict(r) for r in rows]
    except Exception:  # noqa: BLE001
        return []


def changes(ticker: str, metric: str = "gex", days: int = 10) -> dict:
    """Today's cells vs the most recent earlier date, with percent change.

    Captures today lazily, then for each `(expiry, strike)` present today returns
    ``value`` (today), ``prev`` (the same key on the previous date) and
    ``chg_pct = (value - prev) / |prev| * 100``. `chg_pct` is None when there is
    no prior row or the prior value is zero.
    """
    ticker = str(ticker or "").upper().strip()
    metric = str(metric or "gex").lower()
    if metric not in _METRICS:
        metric = "gex"
    days = max(1, min(int(_fnum(days, 10) or 10), _MAX_DAYS))
    date = et_date()
    empty = {"ticker": ticker, "date": date, "prev_date": None, "metric": metric, "cells": []}
    if not ticker:
        return empty

    capture(ticker, date)
    rows = history(ticker, days)
    if not rows:
        return empty

    today: dict[tuple, dict] = {}
    prev_dates: set[str] = set()
    for r in rows:
        d = r.get("date")
        key = (str(r.get("expiry")), _fnum(r.get("strike")))
        if d == date:
            today[key] = r
        else:
            prev_dates.add(d)
    prev_date = max(prev_dates) if prev_dates else None
    prev: dict[tuple, dict] = {}
    if prev_date is not None:
        for r in rows:
            if r.get("date") == prev_date:
                prev[(str(r.get("expiry")), _fnum(r.get("strike")))] = r

    cells = []
    for (exp, strike), r in today.items():
        value = _fnum(r.get(metric))
        p = prev.get((exp, strike))
        pval = _fnum(p.get(metric)) if p else None
        chg = None
        if value is not None and pval not in (None, 0):
            chg = round((value - pval) / abs(pval) * 100.0, 4)
        cells.append({"e": exp, "k": strike, "value": value, "prev": pval, "chg_pct": chg})
    cells.sort(key=lambda x: (x["e"], -(x["k"] or 0.0)))
    return {"ticker": ticker, "date": date, "prev_date": prev_date, "metric": metric, "cells": cells}


def summary(ticker: str, metric: str = "gex") -> dict:
    """Compact CLI/status summary for one ticker."""
    ch = changes(ticker, metric)
    moved = [c for c in ch["cells"] if c["chg_pct"] is not None]
    return {
        "db": str(db_path()),
        "ticker": ch["ticker"],
        "date": ch["date"],
        "prev_date": ch["prev_date"],
        "metric": ch["metric"],
        "cells": len(ch["cells"]),
        "compared": len(moved),
        "up": sum(1 for c in moved if c["chg_pct"] > 0),
        "down": sum(1 for c in moved if c["chg_pct"] < 0),
    }


if __name__ == "__main__":
    import json

    symbol = sys.argv[1].upper() if len(sys.argv) > 1 else "MU"
    print(json.dumps(summary(symbol), indent=2))

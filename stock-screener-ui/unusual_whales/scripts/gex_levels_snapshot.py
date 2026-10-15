#!/usr/bin/env python3
"""Persist Unusual Whales GEX levels over time, with the MNQ futures translation.

Problem this solves
-------------------
``/api/stock/{ticker}/gex-levels`` returns only the CURRENT level. Nothing is
historical, so questions like "was the call wall 30400 when MNQ tagged it at
09:30?" are unanswerable after the fact — which is exactly the question that
matters for a wall-fade strategy. This records the level as it happens, so the
levels can be replayed session by session.

What it stores (SQLite, ``unusual_whales/data/gex_levels.db``)
-------------------------------------------------------------
* ``gex_snapshot``   — raw per-ticker NDX/QQQ rows + the NDX cash estimate
* ``mnq_snapshot``   — the NDX->MNQ translation (price, basis, each level in
                       futures points, gamma regime) exactly as computed live
* ``meta``           — daily-cached NDX/QQQ ratio (a daily quantity, so the two
                       /ohlc/1d calls run once per ET day, not once per poll)

Usage
-----
    python scripts/gex_levels_snapshot.py --once          # one capture
    python scripts/gex_levels_snapshot.py                 # loop every 300s
    python scripts/gex_levels_snapshot.py --interval 120

API budget: 3 calls per capture in steady state (~830/day at 5 min) against a
40k/day limit. Read-only; no orders.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
ROOT = SCRIPTS.parent
sys.path.insert(0, str(SCRIPTS))

from mw_session import cme_futures_open, et_now, staleness  # noqa: E402
from nq_basis import fetch_gex, mnq_levels, ndx_cash  # noqa: E402
from uw_client import UWClient  # noqa: E402

DB_PATH = ROOT / "data" / "gex_levels.db"
INDEX_TICKERS = ("NDX", "QQQ")

SCHEMA = """
CREATE TABLE IF NOT EXISTS gex_snapshot (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_ms  INTEGER NOT NULL,
  captured_at  TEXT    NOT NULL,
  ticker       TEXT    NOT NULL,
  api_time     TEXT,
  source       TEXT,
  spot         REAL,
  call_wall    REAL,
  put_wall     REAL,
  gamma_flip   REAL,
  gamma_magnet REAL,
  nearby_flips TEXT,
  raw          TEXT
);
CREATE INDEX IF NOT EXISTS ix_gex_ms     ON gex_snapshot(captured_ms);
CREATE INDEX IF NOT EXISTS ix_gex_ticker ON gex_snapshot(ticker, captured_ms);

CREATE TABLE IF NOT EXISTS mnq_snapshot (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_ms     INTEGER NOT NULL,
  captured_at     TEXT    NOT NULL,
  symbol          TEXT,
  price           REAL,
  price_ts        INTEGER,
  price_age_s     REAL,
  price_stale     INTEGER,
  market_open     INTEGER,
  ndx_cash        REAL,
  qqq             REAL,
  ratio           REAL,
  basis           REAL,
  call_wall_mnq   REAL,
  put_wall_mnq    REAL,
  gamma_flip_mnq  REAL,
  gamma_magnet_mnq REAL,
  regime          TEXT,
  payload         TEXT
);
CREATE INDEX IF NOT EXISTS ix_mnq_ms ON mnq_snapshot(captured_ms);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
"""


def connect(path: Path = DB_PATH) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path, timeout=15)
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(SCHEMA)
    con.commit()
    return con


def _meta_get(con, key, default=None):
    row = con.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return row[0] if row else default


def _meta_set(con, key, value):
    con.execute("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, str(value)))
    con.commit()


def _f(x):
    try:
        v = float(x)
        return v if v == v else None
    except (TypeError, ValueError):
        return None


def today_ratio(con, client, *, refresh: bool = False) -> float | None:
    """NDX/QQQ ratio, cached per ET calendar day (it only changes daily)."""
    key = f"ndx_ratio:{et_now().date().isoformat()}"
    if not refresh:
        cached = _meta_get(con, key)
        if cached:
            try:
                return float(cached)
            except ValueError:
                pass
    est = ndx_cash(client)  # fetches the two /ohlc/1d series
    ratio = est.get("ratio")
    if ratio:
        _meta_set(con, key, ratio)
        if est.get("ratio_date"):
            _meta_set(con, f"ndx_ratio_date:{et_now().date().isoformat()}", est["ratio_date"])
    return ratio


def capture(con, client, *, prefix: str = "MNQ", root: Path | None = None,
            tickers=INDEX_TICKERS, refresh_ratio: bool = False) -> dict:
    """One snapshot: raw index levels + the MNQ translation."""
    now = datetime.now(timezone.utc)
    ms = int(now.timestamp() * 1000)
    iso = now.isoformat(timespec="milliseconds")

    ratio = today_ratio(con, client, refresh=refresh_ratio)
    rows = 0
    for t in tickers:
        g = fetch_gex(client, t)
        if not g:
            continue
        spot = None
        if t == "QQQ":
            est = ndx_cash(client, ratio=ratio)
            spot = est.get("qqq")
        elif t == "NDX" and ratio:
            est = ndx_cash(client, ratio=ratio)
            spot = est.get("value")
        con.execute(
            """INSERT INTO gex_snapshot
               (captured_ms,captured_at,ticker,api_time,source,spot,call_wall,put_wall,
                gamma_flip,gamma_magnet,nearby_flips,raw)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (ms, iso, t, g.get("time"), g.get("source"), spot,
             _f(g.get("call_wall")), _f(g.get("put_wall")), _f(g.get("gamma_flip")),
             _f(g.get("gamma_magnet")), json.dumps(g.get("nearby_flips") or []),
             json.dumps(g)),
        )
        rows += 1

    mnq = mnq_levels(client, prefix=prefix, root=root, ratio=ratio)
    lv = {l["key"]: l for l in mnq.get("levels", [])}
    con.execute(
        """INSERT INTO mnq_snapshot
           (captured_ms,captured_at,symbol,price,price_ts,price_age_s,price_stale,market_open,
            ndx_cash,qqq,ratio,basis,call_wall_mnq,put_wall_mnq,gamma_flip_mnq,
            gamma_magnet_mnq,regime,payload)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (ms, iso, mnq.get("symbol"), mnq.get("price"), mnq.get("price_ts"),
         mnq.get("price_age_s"), int(bool(mnq.get("price_stale"))),
         int(bool(mnq.get("market_open"))), mnq.get("ndx_cash"), mnq.get("qqq"),
         mnq.get("ratio"), mnq.get("basis"),
         lv.get("call_wall", {}).get("mnq"), lv.get("put_wall", {}).get("mnq"),
         lv.get("gamma_flip", {}).get("mnq"), lv.get("gamma_magnet", {}).get("mnq"),
         mnq.get("regime"), json.dumps(mnq)),
    )
    con.commit()
    return {"captured_ms": ms, "captured_at": iso, "ratio": ratio,
            "gex_rows": rows, "mnq": mnq}


def main() -> None:
    ap = argparse.ArgumentParser(description="Snapshot UW GEX levels + MNQ translation")
    ap.add_argument("--db", default=str(DB_PATH))
    ap.add_argument("--interval", type=int, default=300, help="seconds between captures (loop mode)")
    ap.add_argument("--once", action="store_true", help="single capture then exit")
    ap.add_argument("--prefix", default="MNQ", help="futures root (MNQ/NQ)")
    ap.add_argument("--tickers", default=",".join(INDEX_TICKERS))
    ap.add_argument("--all-hours", action="store_true",
                    help="keep capturing during the CME daily halt (default: skip it)")
    ap.add_argument("--refresh-ratio", action="store_true", help="force a fresh NDX/QQQ ratio")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    con = connect(Path(args.db))
    client = UWClient()
    tickers = tuple(t.strip().upper() for t in args.tickers.split(",") if t.strip())

    def one():
        try:
            out = capture(con, client, prefix=args.prefix, tickers=tickers,
                          refresh_ratio=args.refresh_ratio)
        except Exception as exc:  # noqa: BLE001
            print(f"[{datetime.now(timezone.utc).isoformat(timespec='seconds')}] capture failed: {exc}",
                  file=sys.stderr)
            return
        m = out["mnq"]
        lv = {l["key"]: l for l in m.get("levels", [])}
        wall = lv.get("call_wall", {}).get("mnq")
        if not args.quiet:
            print(f"[{out['captured_at'][11:19]}Z] {m.get('symbol') or '-'} px {m.get('price')} "
                  f"({m.get('price_age_s')}s) basis {m.get('basis')} wall {wall} "
                  f"flip {lv.get('gamma_flip', {}).get('mnq')} {m.get('regime') or '-'}"
                  + (f"  STALE: {m.get('errors')}" if m.get("price_stale") else ""))
        con.execute("DELETE FROM gex_snapshot WHERE captured_ms < ?",
                    (out["captured_ms"] - 400 * 24 * 3600 * 1000,))
        con.commit()

    if args.once:
        one()
        return

    print(f"snapshotting {','.join(tickers)} + {args.prefix} every {args.interval}s -> {args.db}")
    print("Ctrl+C to stop.")
    try:
        while True:
            if args.all_hours or cme_futures_open():
                one()
            elif not args.quiet:
                st = staleness(args.prefix)
                print(f"[{datetime.now(timezone.utc).isoformat(timespec='seconds')}] market closed "
                      f"(next open {st['next_open_et']}) — skipping")
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()

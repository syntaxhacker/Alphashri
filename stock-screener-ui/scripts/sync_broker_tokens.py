#!/usr/bin/env python3
"""
Copy broker OAuth tokens from production PostgreSQL to local SQLite.

Usage:
    python scripts/sync_broker_tokens.py
    PROD_DATABASE_URL=postgresql://... python scripts/sync_broker_tokens.py
    python scripts/sync_broker_tokens.py --broker upstox
    python scripts/sync_broker_tokens.py --dry-run
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import create_engine, text
from rich.console import Console

console = Console()

PROD_DATABASE_URL = os.getenv("PROD_DATABASE_URL", "")

LOCAL_DB_PATH = Path(__file__).parent.parent / "db" / "alphashri.db"
LOCAL_DATABASE_URL = f"sqlite:///{LOCAL_DB_PATH}"


def sync_broker_tokens(broker: str = None, dry_run: bool = False):
    prod_url = os.getenv("PROD_DATABASE_URL", "")
    if not prod_url:
        console.print("[red]PROD_DATABASE_URL env var not set. Exiting.[/red]")
        return
    prod_engine = create_engine(prod_url)
    local_engine = create_engine(LOCAL_DATABASE_URL)

    where_clause = ""
    params = {}
    if broker:
        where_clause = "WHERE broker_name = :broker"
        params["broker"] = broker

    with prod_engine.connect() as pc:
        rows = pc.execute(
            text(f"SELECT broker_name, access_token, token_timestamp, user_id FROM broker_connections {where_clause}"),
            params,
        ).fetchall()

    if not rows:
        console.print("[yellow]No broker tokens found in production.[/yellow]")
        return

    console.print(f"[bold]Found {len(rows)} broker token(s) in production:[/bold]\n")

    for row in rows:
        broker_name, token, ts, user_id = row
        user_label = f"user_id={user_id}" if user_id else "shared"
        console.print(f"  {broker_name} ({user_label}, token_len={len(token)}, updated={ts})")

    if dry_run:
        console.print("\n[dim]Dry run — skipping local DB write.[/dim]")
        return

    with local_engine.connect() as lc:
        lc.execute(text("CREATE TABLE IF NOT EXISTS broker_connections ("
                       "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                       "broker_name VARCHAR(50) NOT NULL, "
                       "access_token TEXT NOT NULL, "
                       "token_timestamp DATETIME NOT NULL, "
                       "user_id INTEGER, "
                       "created_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
                       "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)"))

        inserted = 0
        updated = 0
        for broker_name, token, ts, user_id in rows:
            existing = lc.execute(
                text("SELECT id FROM broker_connections WHERE broker_name = :broker AND user_id IS :uid"),
                {"broker": broker_name, "uid": user_id},
            ).fetchone()

            if existing:
                lc.execute(
                    text("UPDATE broker_connections SET access_token = :token, token_timestamp = :ts, "
                         "updated_at = CURRENT_TIMESTAMP WHERE broker_name = :broker AND user_id IS :uid"),
                    {"token": token, "ts": ts.isoformat(), "broker": broker_name, "uid": user_id},
                )
                updated += 1
            else:
                lc.execute(
                    text("INSERT INTO broker_connections (broker_name, access_token, token_timestamp, user_id) "
                         "VALUES (:broker, :token, :ts, :uid)"),
                    {"broker": broker_name, "token": token, "ts": ts.isoformat(), "uid": user_id},
                )
                inserted += 1

        lc.commit()

    console.print(f"\n[green]Done: {inserted} inserted, {updated} updated in local DB.[/green]")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Sync broker tokens from production to local DB")
    parser.add_argument("--broker", type=str, help="Only sync a specific broker (e.g. upstox)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    args = parser.parse_args()

    sync_broker_tokens(broker=args.broker, dry_run=args.dry_run)

#!/usr/bin/env python3
"""Seed the agri price cache from the IndiaDataPortal CKAN Agmarknet mirror.

Streams the cached CSV (default /tmp/opencode/apmc.csv), keeps only tracked
commodities and upserts them into reports/agri/agri_prices.db. The CSV and DB
are local build artifacts; neither is committed.

Usage:
  .venv/bin/python scripts/market/agri_import.py --csv /tmp/opencode/apmc.csv \
      --db reports/agri/agri_prices.db
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.agri import aggregate, registry, store  # noqa: E402

DEFAULT_CSV = Path("/tmp/opencode/apmc.csv")
BATCH_SIZE = 20_000
PROGRESS_EVERY = 500_000


def import_csv(
    csv_path: Path,
    db_path: Optional[Path] = None,
    *,
    limit: Optional[int] = None,
) -> dict[str, Any]:
    conn = store.open_writer(db_path)
    batch: list[dict[str, Any]] = []
    scanned = 0
    kept = 0
    skipped = 0
    arrival_units: dict[str, int] = {}
    price_units: dict[str, int] = {}

    def flush() -> None:
        if batch:
            store.upsert_rows(conn, batch)
            batch.clear()

    try:
        with open(csv_path, newline="", encoding="utf-8-sig") as handle:
            reader = csv.DictReader(handle)
            for raw in reader:
                scanned += 1
                if limit is not None and scanned > limit:
                    scanned -= 1
                    break
                row = aggregate.normalize_source_row(raw, source=registry.SOURCE_CKAN)
                if row is None:
                    skipped += 1
                else:
                    batch.append(row)
                    kept += 1
                    unit = row.get("arrival_units") or "(blank)"
                    arrival_units[unit] = arrival_units.get(unit, 0) + 1
                    unit = row.get("price_unit") or "(blank)"
                    price_units[unit] = price_units.get(unit, 0) + 1
                if len(batch) >= BATCH_SIZE:
                    flush()
                if scanned % PROGRESS_EVERY == 0:
                    print(f"  scanned {scanned:,} rows, kept {kept:,} ...", flush=True)
        flush()

        min_date, max_date = store.date_range(conn)
        return {
            "csv": str(csv_path),
            "db": str(db_path or store.default_db_path()),
            "scanned": scanned,
            "kept": kept,
            "skipped": skipped,
            "stored": store.count_rows(conn),
            "min_date": min_date,
            "max_date": max_date,
            "arrival_units": dict(sorted(arrival_units.items(), key=lambda kv: -kv[1])),
            "price_units": dict(sorted(price_units.items(), key=lambda kv: -kv[1])),
        }
    finally:
        conn.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="Import tracked agri commodities into the local SQLite cache")
    ap.add_argument("--csv", type=Path, default=DEFAULT_CSV, help=f"Source CSV (default {DEFAULT_CSV})")
    ap.add_argument("--db", type=Path, default=None, help="Target SQLite path (default reports/agri/agri_prices.db)")
    ap.add_argument("--limit", type=int, default=None, help="Scan at most N source rows")
    args = ap.parse_args()

    if not args.csv.exists():
        print(f"ERROR: source CSV not found: {args.csv}", file=sys.stderr)
        raise SystemExit(1)

    stats = import_csv(args.csv, args.db, limit=args.limit)
    print(f"AGRI IMPORT — {stats['csv']}")
    print(f"  scanned : {stats['scanned']:,}")
    print(f"  tracked : {stats['kept']:,}")
    print(f"  skipped : {stats['skipped']:,}")
    print(f"  stored  : {stats['stored']:,} distinct rows in {stats['db']}")
    print(f"  dates   : {stats['min_date']} → {stats['max_date']}")
    print(f"  arrivals: {stats['arrival_units']}")
    print(f"  prices  : {stats['price_units']}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Collect one day of mandi prices from data.gov.in into the agri price cache.

Uses the **historical** Variety-wise resource (``35985678-…``), which accepts
``filters[Arrival_Date]=dd/MM/YYYY`` and carries exact rows back to 2009; the
older ``9ef84268-…`` feed is current-day only. Writes to the local SQLite cache
and a flat CSV mirror. Commodity names come from ``api/agri/registry.py``;
deliveries are tagged with the ``agmarknet_daily`` source.

Usage:
  .venv/bin/python scripts/market/agri_collect.py --dry-run
  .venv/bin/python scripts/market/agri_collect.py --commodity onion,potato
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import requests

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.agri import aggregate, registry, store  # noqa: E402

API_KEY = os.getenv("DATA_GOV_IN_API_KEY", "")
RESOURCE_ID = registry.DATA_GOV_IN_RESOURCE_ID
API_URL = f"https://api.data.gov.in/resource/{RESOURCE_ID}"
# data.gov.in hangs on the default `python-requests` UA; curl/8.x is accepted.
HEADERS = {"User-Agent": "curl/8.5.0", "Accept": "application/json"}

OUT_DIR = ROOT / "reports" / "agri"
OUT_FILE = OUT_DIR / "daily_prices.csv"
CSV_COLUMNS = [
    "collection_date", "arrival_date", "state", "district", "market",
    "commodity", "commodity_key", "variety", "grade", "min_price",
    "max_price", "modal_price", "arrivals_qtl", "price_unit", "source",
]


def fetch_names() -> dict[str, list[str]]:
    """data.gov.in spellings first, CKAN names as fallback."""
    out: dict[str, list[str]] = {}
    for item in registry.COMMODITIES:
        names = list(dict.fromkeys([*item.aliases, *item.source_names]))
        out[item.key] = names
    return out


def _get(params: dict[str, Any], tries: int = 4) -> Optional[requests.Response]:
    for attempt in range(tries):
        try:
            response = requests.get(API_URL, params=params, headers=HEADERS, timeout=60)
            if response.status_code == 200:
                return response
            if response.status_code in (429, 502, 503, 504):
                time.sleep(2 * (attempt + 1))
                continue
            return response
        except requests.RequestException:
            time.sleep(2 * (attempt + 1))
    return None


def fetch_today(names: list[str], date_str: str) -> tuple[list[dict[str, Any]], str]:
    """Return records plus the matched commodity name for one arrival date."""
    for name in names:
        response = _get({
            "api-key": API_KEY,
            "format": "json",
            "limit": 1000,
            # Uppercase field ids are required by the historical resource.
            "filters[Commodity]": name,
            "filters[Arrival_Date]": date_str,
        })
        if response is None:
            continue
        try:
            records = response.json().get("records", [])
        except ValueError:
            continue
        if records:
            return records, name
    return [], ""


def collect(keys: list[str], date_str: str, *, dry_run: bool = False, db_path: Optional[Path] = None) -> int:
    names_by_key = fetch_names()
    conn = store.open_writer(db_path)
    try:
        existing = {
            row[0] for row in conn.execute(
                f"SELECT DISTINCT date FROM {store.TABLE} WHERE source = ?",
                (registry.SOURCE_DAILY,),
            )
        }
        iso_day = aggregate.parse_date(date_str)
        if iso_day in existing:
            print(f"{iso_day} already collected from data.gov.in; nothing to do")
            return 0

        rows: list[dict[str, Any]] = []
        for key in keys:
            records, matched = fetch_today(names_by_key.get(key, []), date_str)
            if not records:
                print(f"  {key:<14} no records for {date_str}")
                continue
            for record in records:
                normalized = aggregate.normalize_source_row(record, source=registry.SOURCE_DAILY)
                if normalized is None:
                    continue
                normalized["commodity_key"] = key
                rows.append(normalized)
            print(f"  {key:<14} {len(records)} records (matched '{matched}')")

        if not rows:
            print("No new rows to write.")
            return 0

        if dry_run:
            print(f"[dry-run] would upsert {len(rows)} rows into {db_path or store.default_db_path()}")
            for row in rows[:5]:
                print("   ", row)
            return len(rows)

        written = store.upsert_rows(conn, rows)
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        write_header = not OUT_FILE.exists()
        with open(OUT_FILE, "a", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=CSV_COLUMNS)
            if write_header:
                writer.writeheader()
            for row in rows:
                writer.writerow({
                    "collection_date": datetime.now(  # noqa: DTZ005 - local wall clock for a log column
                    ).strftime("%Y-%m-%d %H:%M"),
                    "arrival_date": row["date"],
                    "state": row["state"],
                    "district": row["district"],
                    "market": row["market"],
                    "commodity": row["commodity"],
                    "commodity_key": row["commodity_key"],
                    "variety": row["variety"],
                    "grade": row["grade"],
                    "min_price": row["min_price"],
                    "max_price": row["max_price"],
                    "modal_price": row["modal_price"],
                    "arrivals_qtl": row["arrivals_qtl"],
                    "price_unit": row["price_unit"],
                    "source": row["source"],
                })
        print(f"Upserted {written} rows → {db_path or store.default_db_path()}")
        print(f"Mirrored {len(rows)} rows → {OUT_FILE}")
        return written
    finally:
        conn.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="Collect today's agri mandi prices into the local cache")
    ap.add_argument("--commodity", default=",".join(registry.valid_keys()),
                    help="Comma-separated commodity keys (default: all tracked)")
    ap.add_argument("--date", default=datetime.now().strftime("%d/%m/%Y"),
                    help="Arrival date DD/MM/YYYY (default: today)")
    ap.add_argument("--dry-run", action="store_true", help="Preview without writing")
    ap.add_argument("--db", type=Path, default=None, help="Target SQLite path")
    args = ap.parse_args()

    if not API_KEY:
        print("ERROR: DATA_GOV_IN_API_KEY environment variable is not set.", file=sys.stderr)
        print("Export it before running, e.g.: export DATA_GOV_IN_API_KEY=...", file=sys.stderr)
        raise SystemExit(1)

    keys: list[str] = []
    invalid: list[str] = []
    for value in args.commodity.split(","):
        token = value.strip()
        if not token:
            continue
        key = registry.commodity_key_for(token)
        if key:
            keys.append(key)
        else:
            invalid.append(token)
    if invalid:
        print(f"ERROR: unknown commodity keys: {', '.join(invalid)}", file=sys.stderr)
        raise SystemExit(1)

    print(f"AGRI DAILY COLLECT — date {args.date}, {len(keys)} commodities")
    print("-" * 50)
    collect(keys, args.date, dry_run=args.dry_run, db_path=args.db)


if __name__ == "__main__":
    main()

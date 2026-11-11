#!/usr/bin/env python3
"""
Agri-commodity "scalp" collector — builds a daily mandi price history.

Pulls TODAY's wholesale mandi prices from the Government of India Agmarknet
API (data.gov.in) for rice, wheat and the main dals/pulses, and APPENDS them
to `reports/agri/daily_prices.csv`. Run once per day (cron / start.sh) to grow
a 6-month+ time series that the /agri page charts.

Data source: https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070
  (Current Daily Price of Various Commodities from Various Markets (Mandi))
  Fields: state, district, market, commodity, variety, grade, arrival_date,
          min_price, max_price, modal_price
  NOTE: the free endpoint returns CURRENT-DAY prices only — there is no
  unauthenticated historical bulk download, so this collector is how you build
  your own history, one day at a time.

Usage:
  .venv/bin/python scripts/market/agri_collect.py          # collect today
  .venv/bin/python scripts/market/agri_collect.py --dry-run # preview, no write
  .venv/bin/python scripts/market/agri_collect.py --commodity Rice,Tur  # subset
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import requests

API_KEY = os.getenv("DATA_GOV_IN_API_KEY", "")
RESOURCE_ID = "9ef84268-d588-465a-a308-a864a43d0070"
API_URL = f"https://api.data.gov.in/resource/{RESOURCE_ID}"
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64)", "Accept": "application/json"}

# Default basket: rice + dals/pulses + staples. Commodity names must match
# Agmarknet's `commodity` field exactly (case-sensitive).
DEFAULT_COMMODITIES = [
    "Rice",
    "Paddy(Common)",
    "Arhar(Tur)",
    "Moong",
    "Urad",
    "Masoor",
    "Chana",
    "Gram Dal",
    "Wheat",
    "Soyabean",
    "Onion",
    "Potato",
    "Tomato",
]

# alias fallbacks if the exact name returns no rows
ALIASES = {
    "Arhar(Tur)": ["Arhar", "Tur"],
    "Gram Dal": ["Gram dal", "Chana Dal"],
    "Paddy(Common)": ["Paddy"],
}

OUT_DIR = Path("reports/agri")
OUT_FILE = OUT_DIR / "daily_prices.csv"
CSV_COLUMNS = [
    "collection_date", "arrival_date", "state", "district", "market",
    "commodity", "variety", "grade", "min_price", "max_price", "modal_price",
]


def _get(params, tries=4):
    for t in range(tries):
        try:
            r = requests.get(API_URL, params=params, headers=HEADERS, timeout=60)
            if r.status_code == 200:
                return r
            if r.status_code in (429, 502, 503, 504):
                time.sleep(2 * (t + 1))
                continue
            return r
        except Exception:
            time.sleep(2 * (t + 1))
    return None


def fetch_today(commodity: str, date_str: str):
    """Return list of records for one commodity on `date_str` (DD/MM/YYYY)."""
    names = [commodity] + ALIASES.get(commodity, [])
    for name in names:
        r = _get({
            "api-key": API_KEY, "format": "json", "limit": 2000,
            "filters[commodity]": name, "filters[arrival_date]": date_str,
        })
        if r:
            recs = r.json().get("records", [])
            if recs:
                return recs
    return []


def to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def collect(commodities, date_str, dry_run=False):
    """Collect today's prices for `commodities`. Returns rows written."""
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Load existing history so we don't duplicate today's date if re-run.
    existing_dates = set()
    if OUT_FILE.exists():
        with open(OUT_FILE, newline="") as f:
            for row in csv.DictReader(f):
                existing_dates.add(row["arrival_date"])

    rows = []
    for commodity in commodities:
        recs = fetch_today(commodity, date_str)
        if not recs:
            print(f"  {commodity:<18} no records for {date_str}")
            continue
        for rec in recs:
            arrival = rec.get("arrival_date")
            if arrival in existing_dates:
                continue  # already collected for this date
            rows.append({
                "collection_date": datetime.now().strftime("%Y-%m-%d %H:%M"),
                "arrival_date": arrival,
                "state": rec.get("state", ""),
                "district": rec.get("district", ""),
                "market": rec.get("market", ""),
                "commodity": rec.get("commodity", commodity),
                "variety": rec.get("variety", ""),
                "grade": rec.get("grade", ""),
                "min_price": to_float(rec.get("min_price")),
                "max_price": to_float(rec.get("max_price")),
                "modal_price": to_float(rec.get("modal_price")),
            })
        print(f"  {commodity:<18} {len(recs)} records")

    if not rows:
        print("No new rows to write.")
        return 0

    write_header = not OUT_FILE.exists()
    if dry_run:
        print(f"[dry-run] would append {len(rows)} rows to {OUT_FILE}")
        for r in rows[:5]:
            print("   ", r)
        return len(rows)

    with open(OUT_FILE, "a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        if write_header:
            writer.writeheader()
        writer.writerows(rows)
    print(f"Appended {len(rows)} rows → {OUT_FILE}")
    return len(rows)


def main():
    ap = argparse.ArgumentParser(description="Collect today's agri mandi prices into reports/agri/daily_prices.csv")
    ap.add_argument("--commodity", default=",".join(DEFAULT_COMMODITIES),
                    help="Comma-separated commodity names (Agmarknet values)")
    ap.add_argument("--date", default=datetime.now().strftime("%d/%m/%Y"),
                    help="Arrival date DD/MM/YYYY (default: today)")
    ap.add_argument("--dry-run", action="store_true", help="Preview without writing")
    args = ap.parse_args()

    if not API_KEY:
        print("ERROR: DATA_GOV_IN_API_KEY environment variable is not set.", file=sys.stderr)
        print("Export it before running, e.g.:  export DATA_GOV_IN_API_KEY=... ", file=sys.stderr)
        sys.exit(1)

    commodities = [c.strip() for c in args.commodity.split(",") if c.strip()]
    print(f"AGRI SCALP COLLECT — date {args.date}")
    print(f"Commodities: {commodities}")
    print("-" * 50)
    collect(commodities, args.date, dry_run=args.dry_run)


if __name__ == "__main__":
    main()

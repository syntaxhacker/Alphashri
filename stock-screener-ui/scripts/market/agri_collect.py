#!/usr/bin/env python3
"""Collect one whole arrival date of mandi prices from data.gov.in.

The historical resource accepts ``filters[Arrival_Date]=dd/MM/YYYY``. The job
probes ``limit=1`` for ``total`` and ``updated_date``, then pages the **whole
date** with no commodity filter. This replaces the old per-alias fetch, which
stopped at the first non-empty spelling and silently produced partial days
(2026-11-21 had 3,942 rows at the API, not 15,843).

Raw ``Commodity`` spellings are normalised locally through
``api/agri/registry.commodity_key_for``; every spelling for a day is kept, so
``Broken Rice``, ``Paddy(Common)`` and ``Dry Chillies`` do not hide their
siblings.

Usage:
  .venv/bin/python scripts/market/agri_collect.py --dry-run
  .venv/bin/python scripts/market/agri_collect.py --date 21/11/2026
  .venv/bin/python scripts/market/agri_collect.py --date 21/11/2026 --replace-date
  .venv/bin/python scripts/market/agri_collect.py --output-jsonl /tmp/agri.jsonl --no-db
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterable, Optional

import requests

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import config  # noqa: E402
from api.agri import aggregate, registry, store  # noqa: E402

API_KEY = os.getenv("DATA_GOV_IN_API_KEY", "")
RESOURCE_ID = registry.DATA_GOV_IN_RESOURCE_ID
API_URL = f"https://api.data.gov.in/resource/{RESOURCE_ID}"
# data.gov.in hangs on the default `python-requests` UA; curl/8.x is accepted.
HEADERS = {"User-Agent": "curl/8.5.0", "Accept": "application/json"}
PAGE_SIZE = 1000
OUT_DIR = ROOT / "reports" / "agri"

OUTPUT_COLUMNS: tuple[str, ...] = (
    "date", "state", "district", "market", "commodity", "commodity_key",
    "product_form", "variety", "grade", "min_price", "max_price",
    "modal_price", "arrivals_qtl", "arrival_units", "price_unit", "source",
)


class CollectError(Exception):
    """A collection attempt that must not be reported as success."""


class FetchError(CollectError):
    """The upstream API failed, was rate-limited, or returned no usable total."""


class EmptyDateError(CollectError):
    """The date has no published rows and ``--allow-empty`` was not given."""


@dataclass
class CollectResult:
    arrival_date: str
    status: str
    expected_total: int = 0
    fetched_rows: int = 0
    unique_rows: int = 0
    pages: int = 0
    api_updated_at: str = ""
    run_id: str = ""
    missing_keys: tuple[str, ...] = ()
    duplicates: int = 0
    untracked: int = 0
    skipped: bool = False
    output_jsonl: Optional[str] = None
    reasons: tuple[str, ...] = field(default_factory=tuple)


def product_form_for(source_commodity: Optional[str], commodity_key: Optional[str]) -> str:
    """Split the product line the source string already carries.

    Coriander leaves trade per bundle and coriander seed per quintal; blending
    them, or green and dry chilli, produces a meaningless median.
    """
    text = str(source_commodity or "").casefold()
    if commodity_key == "paddy":
        return "basmati" if "basmati" in text else "common"
    if commodity_key == "rice":
        if "broken" in text:
            return "broken"
        if "beaten" in text:
            return "beaten"
        return "rice"
    if commodity_key == "chilli":
        if "green" in text:
            return "green"
        if "dry" in text:
            return "dry"
        if "red" in text or "chili" in text:
            return "red"
        return ""
    if commodity_key == "coriander":
        if "leaves" in text:
            return "leaves"
        if "seed" in text or "corriander" in text:
            return "seed"
        return ""
    if commodity_key == "groundnut":
        if "pod" in text:
            return "pods"
        if "seed" in text or "split" in text:
            return "seed"
        return ""
    if commodity_key == "mustard":
        if "sarson" in text or "colza" in text:
            return "sarson"
        if "toria" in text:
            return "toria"
        return "mustard"
    return ""


def default_arrival_date(now: Optional[datetime] = None) -> str:
    """D-1 in ``config.IST`` — the feed publishes yesterday around 05:12 IST."""
    current = now or datetime.now(config.IST)
    if current.tzinfo is None:
        current = current.replace(tzinfo=config.IST)
    return (current.astimezone(config.IST).date() - timedelta(days=1)).isoformat()


def parse_arrival_date(value: str) -> str:
    """Accept ``DD/MM/YYYY`` (documented) and ISO; return ISO."""
    text = str(value or "").strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    raise ValueError(f"invalid date {value!r}; expected DD/MM/YYYY")


def _api_date(iso_day: str) -> str:
    return datetime.strptime(iso_day, "%Y-%m-%d").strftime("%d/%m/%Y")


def _get(params: dict[str, Any], *, api_key: str, tries: int = 3) -> requests.Response:
    query = {"api-key": api_key, "format": "json", **params}
    last_error: Optional[BaseException] = None
    for attempt in range(tries):
        try:
            response = requests.get(API_URL, params=query, headers=HEADERS, timeout=60)
        except requests.RequestException as exc:  # network flake — retry
            last_error = exc
            time.sleep(2 * (attempt + 1))
            continue
        if response.status_code == 200:
            return response
        if response.status_code == 429:
            # Retrying inside the same run only burns more quota.
            raise FetchError(
                "data.gov.in returned HTTP 429 (rate limited); the date was not accepted"
            )
        if response.status_code in (502, 503, 504):
            last_error = FetchError(f"data.gov.in returned HTTP {response.status_code}")
            time.sleep(2 * (attempt + 1))
            continue
        raise FetchError(f"data.gov.in returned HTTP {response.status_code}")
    raise FetchError(f"data.gov.in request failed: {last_error}")


def _payload(response: requests.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError as exc:
        raise FetchError("data.gov.in response was not JSON") from exc
    if not isinstance(payload, dict):
        raise FetchError("data.gov.in response was not a JSON object")
    return payload


def probe_date(iso_day: str, *, api_key: str) -> tuple[int, str]:
    """``limit=1`` tells us how many rows the whole date has, and when it moved."""
    payload = _payload(_get({
        "limit": 1,
        "filters[Arrival_Date]": _api_date(iso_day),
    }, api_key=api_key))
    raw_total = payload.get("total", payload.get("count"))
    if raw_total is None:
        # Guessing from a one-row probe would make a short page look complete.
        raise FetchError("probe response carried no total; refusing to page blindly")
    try:
        total = int(raw_total)
    except (TypeError, ValueError) as exc:
        raise FetchError(f"probe returned a non-numeric total: {raw_total!r}") from exc
    updated = str(payload.get("updated_date") or payload.get("updated_at") or "")
    return total, updated


def fetch_page(iso_day: str, offset: int, *, api_key: str, limit: int = PAGE_SIZE) -> list[dict[str, Any]]:
    payload = _payload(_get({
        "limit": limit,
        "offset": offset,
        "filters[Arrival_Date]": _api_date(iso_day),
    }, api_key=api_key))
    records = payload.get("records") or []
    if not isinstance(records, list):
        raise FetchError("data.gov.in page carried a non-list records field")
    return [record for record in records if isinstance(record, dict)]


def fetch_whole_date(
    iso_day: str,
    total: int,
    *,
    api_key: str,
    max_pages: int = 0,
    workers: int = 1,
) -> tuple[list[dict[str, Any]], int, bool]:
    """Fetch every offset for a date, optionally in parallel.

    Offsets are independent, so a 16-page day can be fetched in four waves
    instead of 16 serial round-trips. The caller still validates the total, so
    a short/rate-limited page cannot masquerade as a complete date.
    """
    offsets = list(range(0, total, PAGE_SIZE))
    capped = bool(max_pages and len(offsets) > max_pages)
    if capped:
        offsets = offsets[:max_pages]
    if not offsets:
        return [], 0, False

    if workers <= 1 or len(offsets) == 1:
        records: list[dict[str, Any]] = []
        pages = 0
        for offset in offsets:
            page = fetch_page(iso_day, offset, api_key=api_key)
            pages += 1
            if not page:
                break
            records.extend(page)
            if len(page) < PAGE_SIZE:
                break
        return records, pages, capped

    with ThreadPoolExecutor(max_workers=min(8, max(2, workers))) as pool:
        pages_by_offset = list(pool.map(
            lambda offset: fetch_page(iso_day, offset, api_key=api_key),
            offsets,
        ))
    records = [row for page in pages_by_offset for row in page]
    return records, len(offsets), capped


def _natural_key(row: dict[str, Any]) -> tuple[Any, ...]:
    # Matches the existing table's UNIQUE key, which is deliberately kept.
    return (
        row.get("date"), row.get("state") or "", row.get("district") or "",
        row.get("market") or "", row.get("commodity") or "",
        row.get("variety") or "", row.get("grade") or "",
    )


def normalize_records(
    records: Iterable[dict[str, Any]],
    *,
    ingested_at: str,
) -> tuple[list[dict[str, Any]], int]:
    """Map every raw record through the registry; keep all spellings."""
    rows: list[dict[str, Any]] = []
    untracked = 0
    for record in records:
        row = aggregate.normalize_source_row(record, source=registry.SOURCE_DAILY)
        if row is None:
            untracked += 1
            continue
        raw_name = str(
            record.get("Commodity") or record.get("commodity") or ""
        ).strip()
        row["source_commodity"] = raw_name or row["commodity"]
        row["product_form"] = product_form_for(row["source_commodity"], row["commodity_key"])
        row["price_source"] = registry.SOURCE_DAILY
        row["arrivals_source"] = (
            "daily" if row.get("arrivals_qtl") is not None else "none"
        )
        row["ingested_at"] = ingested_at
        rows.append(row)
    return rows, untracked


def dedupe_rows(rows: Iterable[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    seen: set[tuple[Any, ...]] = set()
    unique: list[dict[str, Any]] = []
    duplicates = 0
    for row in rows:
        key = _natural_key(row)
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        unique.append(row)
    return unique, duplicates


def _assess(
    *,
    total: int,
    rows_seen: int,
    pages: int,
    capped: bool,
    selected_keys: Iterable[str],
    keys_present: set[str],
    duplicates: int,
) -> tuple[str, list[str]]:
    reasons: list[str] = []
    if rows_seen != total:
        reasons.append(f"rows_seen {rows_seen} != api total {total} after {pages} page(s)")
    missing = [key for key in selected_keys if key not in keys_present]
    if missing:
        reasons.append(f"missing tracked keys: {', '.join(missing)}")
    if duplicates:
        # Alias spellings legitimately overlap; dedupe is expected, not a failure.
        reasons.append(f"deduped {duplicates} duplicate natural key row(s)")
    if capped:
        reasons.append(f"stopped at --max-pages={pages} before the whole date was fetched")
    blocking = bool(missing) or capped or rows_seen != total
    return ("partial" if blocking else "complete"), reasons


def _output_row(row: dict[str, Any]) -> dict[str, Any]:
    return {column: row.get(column) for column in OUTPUT_COLUMNS}


def write_jsonl(path: str | Path, rows: Iterable[dict[str, Any]]) -> int:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with open(target, "w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(_output_row(row), ensure_ascii=False, separators=(",", ":")))
            handle.write("\n")
            written += 1
    return written


def collect_date(
    iso_day: str,
    *,
    keys: Optional[Iterable[str]] = None,
    api_key: Optional[str] = None,
    db_path: Optional[str | Path] = None,
    no_db: bool = False,
    dry_run: bool = False,
    replace_date: bool = False,
    allow_empty: bool = False,
    max_pages: int = 0,
    fetch_workers: int = 1,
    output_jsonl: Optional[str | Path] = None,
    run_id: Optional[str] = None,
    now: Optional[datetime] = None,
) -> CollectResult:
    """Fetch, normalise, persist and ledger one whole arrival date."""
    selected_keys = list(dict.fromkeys(keys or registry.valid_keys()))
    key = api_key if api_key is not None else API_KEY
    if not key:
        raise FetchError("DATA_GOV_IN_API_KEY is not set")
    current = now or datetime.now(config.IST)
    if current.tzinfo is None:
        current = current.replace(tzinfo=config.IST)
    started_at = current.astimezone(config.IST).isoformat(timespec="seconds")
    ingested_at = started_at
    run = run_id or uuid.uuid4().hex
    source = registry.SOURCE_DAILY

    conn = None if no_db else store.open_writer(db_path)
    try:
        if conn is not None and not replace_date:
            partition = store.get_partition(conn, source, iso_day)
            if partition and partition["status"] == "complete":
                result = CollectResult(
                    arrival_date=iso_day,
                    status="complete",
                    expected_total=partition["expected_total"] or 0,
                    fetched_rows=partition["fetched_rows"] or 0,
                    unique_rows=partition["fetched_rows"] or 0,
                    pages=0,
                    api_updated_at=partition["api_updated_at"] or "",
                    run_id=run,
                    skipped=True,
                    reasons=("partition already complete; use --replace-date to refetch",),
                )
                return result

        try:
            total, updated_at = probe_date(iso_day, api_key=key)
            if total > 0:
                records, pages, capped = fetch_whole_date(
                    iso_day, total, api_key=key, max_pages=max_pages,
                    workers=fetch_workers,
                )
            else:
                records, pages, capped = [], 0, False

            normalized, untracked = normalize_records(records, ingested_at=ingested_at)
            unique_rows, duplicates = dedupe_rows(normalized)
            keys_present = {row["commodity_key"] for row in unique_rows}

            if total <= 0:
                if not allow_empty:
                    raise EmptyDateError(
                        f"{iso_day} has no published rows; pass --allow-empty for a holiday"
                    )
                status, reasons = "empty", ["date has no published rows (allowed empty)"]
            else:
                status, reasons = _assess(
                    total=total,
                    rows_seen=len(records),
                    pages=pages,
                    capped=capped,
                    selected_keys=selected_keys,
                    keys_present=keys_present,
                    duplicates=duplicates,
                )
            missing = tuple(key_name for key_name in selected_keys if key_name not in keys_present)

            if conn is not None and not dry_run:
                if replace_date:
                    with conn:
                        conn.execute(
                            f"DELETE FROM {store.TABLE} WHERE date = ? AND source = ?",
                            (iso_day, source),
                        )
                written = store.upsert_rows(conn, unique_rows)
                finished_at = datetime.now(config.IST).isoformat(timespec="seconds")
                store.upsert_partition(
                    conn,
                    source=source,
                    arrival_date=iso_day,
                    status=status,
                    expected_total=total,
                    fetched_rows=written,
                    pages=pages,
                    api_updated_at=updated_at or None,
                    run_id=run,
                    started_at=started_at,
                    finished_at=finished_at,
                    error="; ".join(reasons) or None,
                )
            else:
                finished_at = started_at

            output_path = None
            if output_jsonl:
                write_jsonl(output_jsonl, unique_rows)
                output_path = str(output_jsonl)

            return CollectResult(
                arrival_date=iso_day,
                status=status,
                expected_total=total,
                fetched_rows=len(unique_rows),
                unique_rows=len(unique_rows),
                pages=pages,
                api_updated_at=updated_at,
                run_id=run,
                missing_keys=missing,
                duplicates=duplicates,
                untracked=untracked,
                output_jsonl=output_path,
                reasons=tuple(reasons),
            )
        except CollectError as exc:
            if conn is not None and not dry_run:
                finished_at = datetime.now(config.IST).isoformat(timespec="seconds")
                store.upsert_partition(
                    conn,
                    source=source,
                    arrival_date=iso_day,
                    status="failed",
                    expected_total=None,
                    fetched_rows=0,
                    pages=0,
                    api_updated_at=None,
                    run_id=run,
                    started_at=started_at,
                    finished_at=finished_at,
                    error=str(exc),
                )
            raise
    finally:
        if conn is not None:
            conn.close()


def _parse_keys(values: str) -> tuple[list[str], list[str]]:
    keys: list[str] = []
    invalid: list[str] = []
    for value in str(values or "").split(","):
        token = value.strip()
        if not token:
            continue
        key = registry.commodity_key_for(token)
        if key:
            keys.append(key)
        else:
            invalid.append(token)
    return keys, invalid


def _arg_date(value: str) -> str:
    try:
        return parse_arrival_date(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(str(exc)) from exc


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(
        description="Collect one whole date of agri mandi prices into the local cache"
    )
    ap.add_argument("--commodity", default=",".join(registry.valid_keys()),
                    help="Comma-separated commodity keys to require (default: all tracked)")
    ap.add_argument("--date", type=_arg_date, default=None,
                    help="Arrival date DD/MM/YYYY (default: D-1 in Asia/Kolkata)")
    ap.add_argument("--replace-date", action="store_true",
                    help="Refetch a date even when its partition is complete")
    ap.add_argument("--output-jsonl", type=Path, default=None,
                    help="Write normalised rows as one JSON object per line")
    ap.add_argument("--no-db", action="store_true", help="Skip SQLite writes (and the ledger)")
    ap.add_argument("--dry-run", action="store_true",
                    help="Fetch and validate without DB or ledger writes")
    ap.add_argument("--allow-empty", action="store_true",
                    help="Treat a date with zero published rows as a valid holiday")
    ap.add_argument("--max-pages", type=int, default=0,
                    help="Safety cap on pages; hitting it marks the date partial")
    ap.add_argument("--fetch-workers", type=int, default=4,
                    help="Parallel page fetches per date (default 4; use 1 for strict serial)")
    ap.add_argument("--db", type=Path, default=None, help="Target SQLite path")
    args = ap.parse_args(argv)

    if not API_KEY:
        print("ERROR: DATA_GOV_IN_API_KEY environment variable is not set.", file=sys.stderr)
        print("Export it before running, e.g.: export DATA_GOV_IN_API_KEY=...", file=sys.stderr)
        return 1

    keys, invalid = _parse_keys(args.commodity)
    if invalid:
        print(f"ERROR: unknown commodity keys: {', '.join(invalid)}", file=sys.stderr)
        return 1
    if not keys:
        print("ERROR: no commodity keys selected", file=sys.stderr)
        return 1

    iso_day = args.date or default_arrival_date()
    print(f"AGRI DAILY COLLECT — {iso_day} ({_api_date(iso_day)}), {len(keys)} key(s)")
    print("-" * 60)
    try:
        result = collect_date(
            iso_day,
            keys=keys,
            db_path=args.db,
            no_db=args.no_db,
            dry_run=args.dry_run,
            replace_date=args.replace_date,
            allow_empty=args.allow_empty,
            max_pages=args.max_pages,
            fetch_workers=args.fetch_workers,
            output_jsonl=args.output_jsonl,
        )
    except CollectError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print(
        f"{result.status.upper()}: api total {result.expected_total}, "
        f"{result.unique_rows} unique row(s), {result.pages} page(s)"
    )
    for reason in result.reasons:
        print(f"  - {reason}")
    if result.untracked:
        print(f"  - {result.untracked} row(s) mapped outside the tracked registry")
    if result.output_jsonl:
        print(f"Wrote {result.unique_rows} row(s) → {result.output_jsonl}")
    if args.no_db or args.dry_run:
        print("(no SQLite / ledger writes)")
    if result.status == "partial":
        print("This date is retryable; it will not be skipped on the next run.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

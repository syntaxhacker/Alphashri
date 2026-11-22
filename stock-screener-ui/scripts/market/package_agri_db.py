#!/usr/bin/env python3
"""Package complete agri partitions from the local SQLite cache.

Offline counterpart of the ``refresh-agri`` workflow's packaging step. It reads
*only* ``agri_ingest_partitions.status='complete'`` from the local cache and
writes the exact release-shaped layout the workflow uploads::

    build/agri/YYYY-MM-DD.jsonl.gz
    build/manifests/agri-YYYY-MM-DD.json
    build/releases.tsv

The payload/manifest rules are copied from the ``Collect and package agri
deltas`` block of ``.github/workflows/refresh-agri.yml`` (JSONL with sorted
keys, gzip with ``mtime=0``, SHA256 of the *compressed* bytes, and the exact 12
manifest fields). Every written asset is then validated through
``scripts.sync_refresh_assets.validate_asset`` -- the same code the local sync
uses -- before the date is counted as packaged.

The source DB is opened strictly read-only (``mode=ro`` + ``query_only``).
Nothing here writes to the cache, creates a release, or uploads any file.

Usage::

    .venv/bin/python scripts/market/package_agri_db.py
    .venv/bin/python scripts/market/package_agri_db.py --from 2026-11-01 --to 2026-11-21
    .venv/bin/python scripts/market/package_agri_db.py --db /path/to/agri_prices.db --build-dir build
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import sqlite3
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable, Optional
from zoneinfo import ZoneInfo

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from api.agri import registry, store  # noqa: E402
from scripts import sync_refresh_assets as sync  # noqa: E402

KIND: str = "agri"
IST = ZoneInfo("Asia/Kolkata")
# Only the daily collector's partitions produce daily assets. (The cache also
# holds an agmarknet_ckan seed, but it has no daily ingest ledger rows.)
SOURCE: str = registry.SOURCE_DAILY
DEFAULT_DB_PATH: Path = store.DEFAULT_DB_PATH
DEFAULT_BUILD_DIR: Path = PROJECT_ROOT / "build"

# The collector's OUTPUT_COLUMNS (scripts/market/agri_collect.py) plus the four
# fields the refresh-agri.yml packaging step attaches before gzip:
# source_commodity, price_source, arrivals_source, ingested_at. That union is
# exactly store.COLUMNS, so no field is invented or dropped on either side.
OUTPUT_COLUMNS: tuple[str, ...] = store.COLUMNS


class PackageError(RuntimeError):
    """An expected packaging failure (reported without a traceback)."""


@dataclass(frozen=True)
class SkippedPartition:
    """A non-complete ledger partition that was deliberately not packaged."""

    date: str
    source: str
    status: str
    reason: str

    def as_dict(self) -> dict[str, str]:
        return {
            "date": self.date,
            "source": self.source,
            "status": self.status,
            "reason": self.reason,
        }


@dataclass
class PackageResult:
    """Everything produced (and deliberately not produced) by one run."""

    packaged_dates: list[str] = field(default_factory=list)
    skipped: list[SkippedPartition] = field(default_factory=list)
    asset_paths: list[Path] = field(default_factory=list)
    manifest_paths: list[Path] = field(default_factory=list)
    asset_bytes: int = 0
    manifest_bytes: int = 0
    total_bytes: int = 0
    rows: int = 0
    validated: int = 0
    release_groups: dict[str, list[str]] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "packaged_dates": list(self.packaged_dates),
            "skipped": [item.as_dict() for item in self.skipped],
            "asset_bytes": self.asset_bytes,
            "manifest_bytes": self.manifest_bytes,
            "total_bytes": self.total_bytes,
            "rows": self.rows,
            "validated": self.validated,
            "release_groups": {tag: list(paths) for tag, paths in self.release_groups.items()},
        }


# ---------------------------------------------------------------------------
# Read side (strictly read-only)
# ---------------------------------------------------------------------------


def open_read_only(db_path: Optional[str | Path] = None) -> sqlite3.Connection:
    """Open the cache without any chance of creating or migrating it.

    ``store.open_reader`` is deliberately *not* used here: it first opens the
    file as a writer to apply additive schema migrations. This packager must
    never modify the source DB.
    """
    target = Path(db_path) if db_path is not None else DEFAULT_DB_PATH
    if str(target) != ":memory:" and not target.exists():
        raise PackageError(f"Agri DB not found: {target}")
    if str(target) == ":memory:":
        conn = sqlite3.connect(":memory:")
    else:
        conn = sqlite3.connect(f"{target.resolve().as_uri()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = ON")
    return conn


def read_partitions(
    conn: sqlite3.Connection,
    *,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    source: str = SOURCE,
) -> list[dict[str, Any]]:
    """Return ledger rows in the requested date window, oldest first."""
    clauses = ["source = ?"]
    params: list[Any] = [source]
    if from_date:
        clauses.append("arrival_date >= ?")
        params.append(from_date)
    if to_date:
        clauses.append("arrival_date <= ?")
        params.append(to_date)
    sql = (
        f"SELECT source, arrival_date, status, expected_total, fetched_rows, error "
        f"FROM {store.LEDGER_TABLE} WHERE {' AND '.join(clauses)} "
        "ORDER BY arrival_date, source"
    )
    return [dict(row) for row in conn.execute(sql, params)]


def select_partitions(
    partitions: Iterable[dict[str, Any]],
) -> tuple[list[str], list[SkippedPartition]]:
    """Split ledger rows into complete dates and explicitly skipped dates.

    A date is packaged only when every partition for it is ``complete``. Any
    ``partial``/``failed``/other status is listed as skipped with its ledger
    error; it is never promoted to complete.
    """
    by_date: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for partition in partitions:
        by_date[str(partition["arrival_date"])].append(partition)

    complete: list[str] = []
    skipped: list[SkippedPartition] = []
    for day in sorted(by_date):
        bad = [
            item for item in by_date[day]
            if str(item.get("status") or "").strip().lower() != "complete"
        ]
        if bad:
            for item in bad:
                reason = str(item.get("error") or "").strip()
                skipped.append(
                    SkippedPartition(
                        date=day,
                        source=str(item.get("source") or ""),
                        status=str(item.get("status") or ""),
                        reason=reason or f"partition status is {item.get('status')!r}, not 'complete'",
                    )
                )
        else:
            complete.append(day)
    return complete, skipped


def fetch_rows(
    conn: sqlite3.Connection,
    day: str,
    *,
    source: str = SOURCE,
) -> list[dict[str, Any]]:
    """One date of daily-collector rows in the store's canonical row order."""
    columns = ", ".join(OUTPUT_COLUMNS)
    sql = (
        f"SELECT {columns} FROM {store.TABLE} "
        "WHERE date = ? AND source = ? "
        "ORDER BY date, state, district, market, commodity, variety, grade"
    )
    return [dict(row) for row in conn.execute(sql, (day, source))]


# ---------------------------------------------------------------------------
# Write side (mirrors the workflow packaging block)
# ---------------------------------------------------------------------------


def _commodity_key(row: dict[str, Any]) -> Optional[str]:
    """Same resolution order as sync's agri commodity check."""
    key = row.get("commodity_key")
    if key:
        return str(key)
    for field_name in ("source_commodity", "commodity"):
        resolved = registry.commodity_key_for(row.get(field_name))
        if resolved:
            return resolved
    return None


def serialize_rows(rows: Iterable[dict[str, Any]]) -> bytes:
    """JSONL with sorted keys and compact separators, then gzip with mtime=0."""
    payload = "".join(
        json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n"
        for row in rows
    ).encode("utf-8")
    return gzip.compress(payload, mtime=0)


def build_manifest(
    rows: Iterable[dict[str, Any]],
    day: str,
    sha256: str,
    *,
    created_at: Optional[str] = None,
    quarantined: int = 0,
    duplicates: int = 0,
) -> dict[str, Any]:
    """The exact 12 manifest fields written by refresh-agri.yml.

    Rows read from the cache are already validated and de-duplicated by the
    collector and the table's UNIQUE constraint, so no new rows are
    quarantined here and no duplicates are removed: both counters are 0.
    """
    rows = list(rows)
    return {
        "kind": KIND,
        "as_of": day,
        "date": day,
        "rows": len(rows),
        "commodities": len({key for row in rows if (key := _commodity_key(row)) is not None}),
        "source": f"data.gov.in/{registry.DATA_GOV_IN_RESOURCE_ID}",
        "arrivals_present": any(
            row.get("arrivals_qtl") is not None or row.get("arrivals") is not None
            for row in rows
        ),
        "sha256": sha256,
        "created_at": created_at or datetime.now(IST).isoformat(timespec="seconds"),
        "status": "complete",
        "quarantined": quarantined,
        "duplicates": duplicates,
    }


def asset_path_for(day: str, build_dir: str | Path) -> Path:
    return Path(build_dir) / "agri" / f"{day}.jsonl.gz"


def manifest_path_for(day: str, build_dir: str | Path) -> Path:
    return Path(build_dir) / "manifests" / f"agri-{day}.json"


def _display_path(path: Path) -> str:
    """Release paths are repo-relative, matching build/upload_files.txt."""
    path = Path(path)
    try:
        return path.resolve().relative_to(PROJECT_ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def validate_generated(
    day: str,
    build_dir: str | Path,
) -> sync.ValidatedAsset:
    """Re-check a written pair with the local sync's own validation code."""
    asset = asset_path_for(day, build_dir)
    manifest = manifest_path_for(day, build_dir)
    tag = f"data-{day[:7]}"
    pair = sync.AssetPair(
        kind=KIND,
        as_of=day,
        release=tag,
        asset=sync.ReleaseAsset(
            release=tag,
            name=sync.asset_name(KIND, day),
            local_path=asset,
            size=asset.stat().st_size,
        ),
        manifest=sync.ReleaseAsset(
            release=tag,
            name=sync.manifest_name(KIND, day),
            local_path=manifest,
            size=manifest.stat().st_size,
        ),
    )
    return sync.validate_asset(pair, asset)


def write_releases_tsv(result: PackageResult, build_dir: str | Path) -> Path:
    """Group packaged paths by monthly ``data-YYYY-MM`` tag (workflow order)."""
    grouped: dict[str, set[str]] = defaultdict(set)
    for day in result.packaged_dates:
        tag = f"data-{day[:7]}"
        grouped[tag].add(_display_path(asset_path_for(day, build_dir)))
        grouped[tag].add(_display_path(manifest_path_for(day, build_dir)))

    lines = [
        f"{tag}\t{' '.join(sorted(paths))}"
        for tag, paths in sorted(grouped.items())
    ]
    target = Path(build_dir) / "releases.tsv"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        "".join(f"{line}\n" for line in lines),
        encoding="utf-8",
    )
    result.release_groups = {
        tag: sorted(paths) for tag, paths in sorted(grouped.items())
    }
    return target


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def _check_range(from_date: Optional[str], to_date: Optional[str]) -> None:
    parsed: list[date] = []
    for label, value in (("--from", from_date), ("--to", to_date)):
        if not value:
            continue
        try:
            parsed.append(date.fromisoformat(value))
        except ValueError as exc:
            raise PackageError(f"invalid {label} date: {exc}") from exc
    if (from_date and not to_date) or (to_date and not from_date):
        raise PackageError("--from and --to must be provided together")
    if len(parsed) == 2 and parsed[0] > parsed[1]:
        raise PackageError("--from must be on or before --to")


def package_from_db(
    db_path: Optional[str | Path] = None,
    build_dir: Optional[str | Path] = None,
    *,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    created_at: Optional[str] = None,
) -> PackageResult:
    """Package every complete daily partition in ``[from_date, to_date]``.

    With no date window, all complete partitions are packaged. Non-complete
    partitions in the window are returned in ``result.skipped`` and no asset
    is written for them.
    """
    _check_range(from_date, to_date)
    target_dir = Path(build_dir) if build_dir is not None else DEFAULT_BUILD_DIR

    conn = open_read_only(db_path)
    try:
        partitions = read_partitions(conn, from_date=from_date, to_date=to_date)
        complete_dates, skipped = select_partitions(partitions)
        result = PackageResult(skipped=skipped)

        (target_dir / "agri").mkdir(parents=True, exist_ok=True)
        (target_dir / "manifests").mkdir(parents=True, exist_ok=True)

        for day in complete_dates:
            rows = fetch_rows(conn, day)
            compressed = serialize_rows(rows)
            sha256 = hashlib.sha256(compressed).hexdigest()

            asset = asset_path_for(day, target_dir)
            asset.write_bytes(compressed)
            manifest = build_manifest(rows, day, sha256, created_at=created_at)
            manifest_file = manifest_path_for(day, target_dir)
            manifest_file.write_text(
                json.dumps(manifest, indent=2) + "\n",
                encoding="utf-8",
            )

            # Fail on any mismatch before this date counts as packaged.
            validate_generated(day, target_dir)

            result.packaged_dates.append(day)
            result.asset_paths.append(asset)
            result.manifest_paths.append(manifest_file)
            result.asset_bytes += len(compressed)
            result.manifest_bytes += manifest_file.stat().st_size
            result.rows += len(rows)
            result.validated += 1

        result.total_bytes = result.asset_bytes + result.manifest_bytes
        write_releases_tsv(result, target_dir)
        return result
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Package complete agri partitions from the local SQLite cache."
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB_PATH,
        help=f"Local agri SQLite cache (default: {DEFAULT_DB_PATH})",
    )
    parser.add_argument(
        "--build-dir",
        type=Path,
        default=DEFAULT_BUILD_DIR,
        help=f"Release-shaped output directory (default: {DEFAULT_BUILD_DIR})",
    )
    parser.add_argument("--from", dest="from_date", help="First arrival date (YYYY-MM-DD)")
    parser.add_argument("--to", dest="to_date", help="Last arrival date (YYYY-MM-DD)")
    return parser


def _print_report(result: PackageResult) -> None:
    dates = result.packaged_dates
    print(f"Validated {result.validated}/{len(dates)} generated asset(s) with sync rules.")
    if dates:
        print(f"Packaged {len(dates)} date(s) ({dates[0]} .. {dates[-1]}):")
        print("  " + ", ".join(dates))
    else:
        print("Packaged 0 date(s); no assets written.")
    if result.skipped:
        print(f"Skipped {len(result.skipped)} partition(s) (not complete):")
        for item in result.skipped:
            print(f"  {item.date} [{item.source}] {item.status}: {item.reason}")
    else:
        print("Skipped 0 partition(s).")
    print(
        f"Bytes: {result.total_bytes} total "
        f"({result.asset_bytes} assets + {result.manifest_bytes} manifests); "
        f"{result.rows} rows."
    )
    if result.release_groups:
        print("Monthly release groups:")
        for tag, paths in result.release_groups.items():
            print(f"  {tag} ({len(paths)} paths)")
    else:
        print("Monthly release groups: none (empty releases.tsv).")


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = package_from_db(
            args.db,
            args.build_dir,
            from_date=args.from_date,
            to_date=args.to_date,
        )
    except (PackageError, sync.SyncError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    _print_report(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

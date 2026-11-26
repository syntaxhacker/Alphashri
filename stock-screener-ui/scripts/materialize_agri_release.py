#!/usr/bin/env python3
"""Build a cumulative agri release snapshot from validated GitHub Release assets.

The snapshot contains only agri rows, in the same schema as the local cache, plus
a manifest describing the data window. It never touches the main cache, 52W
tables, Redis or the refresh ledger. Downloads reuse ``sync_refresh_assets``
validation (manifest, sha256, row count, date, status=complete).

Example:
    .venv/bin/python scripts/materialize_agri_release.py \\
      --release-tag data-2026-11 \\
      --out reports/agri/releases/data-2026-11 \\
      --from 2025-10-27 [--cache-dir reports/refresh_assets] \\
      [--repo syntaxhacker/Alphashri] [--assets-dir DIR] [--dry-run] [--force]
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable, Optional

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import config  # noqa: E402

from api.agri import sources, store  # noqa: E402
from scripts import sync_refresh_assets as sync  # noqa: E402

DEFAULT_REPO = sync.DEFAULT_REPO
DEFAULT_CACHE_DIR = sync.DEFAULT_CACHE_DIR


class MaterializeError(RuntimeError):
    """Expected materializer failure (reported without a traceback)."""


@dataclass(frozen=True)
class BuildStats:
    as_of: Optional[str]
    rows: int
    dates: list[str]
    quarantined: int

    def as_dict(self) -> dict[str, Any]:
        return {
            "as_of": self.as_of,
            "rows": self.rows,
            "dates": self.dates,
            "quarantined": self.quarantined,
        }


def _manifest_for_asset(asset: Path, as_of: str) -> Path:
    candidates = (
        asset.parent.parent / "manifests" / f"agri-{as_of}.json",
        asset.parent / f"agri-{as_of}.json",
        asset.parent.parent / f"agri-{as_of}.json",
    )
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise MaterializeError(f"missing manifest for {asset.name}")


def _validate_local_asset(asset: Path, manifest: Optional[Path] = None) -> sync.ValidatedAsset:
    match = sync.ASSET_PATTERNS["agri"].match(asset.name)
    if match is None:
        raise MaterializeError(f"not an agri daily asset: {asset.name}")
    as_of = match.group(1)
    manifest = manifest or _manifest_for_asset(asset, as_of)
    pair = sync.AssetPair(
        kind="agri",
        as_of=as_of,
        release="local",
        asset=sync.ReleaseAsset(
            release="local", name=asset.name, local_path=asset, size=asset.stat().st_size
        ),
        manifest=sync.ReleaseAsset(
            release="local", name=manifest.name, local_path=manifest,
            size=manifest.stat().st_size,
        ),
    )
    return sync.validate_asset(pair, asset)


def materialize_from_assets(
    asset_paths: Iterable[Path | tuple[Path, Path]],
    out_db: Path,
) -> BuildStats:
    """Write cumulative agri rows from local, already-validated asset files.

    ``asset_paths`` entries are gzip asset paths, or ``(asset, manifest)`` pairs
    when the manifest does not sit beside the asset. Only ``out_db`` is written;
    all rows pass the same validation and ``prepare_agri_rows`` rules as sync.
    """
    validated: dict[str, sync.ValidatedAsset] = {}
    for entry in asset_paths:
        if isinstance(entry, tuple):
            asset, manifest = entry
            item = _validate_local_asset(Path(asset), Path(manifest))
        else:
            item = _validate_local_asset(Path(entry))
        validated[item.as_of] = item  # a replayed day must not duplicate rows

    out_db = Path(out_db)
    conn = store.open_writer(out_db)
    try:
        # A single-file DB keeps readers from creating WAL/SHM sidecars, which
        # would violate the snapshot's no-write-on-read guarantee.
        conn.execute("PRAGMA journal_mode=DELETE")
        quarantined = 0
        for as_of in sorted(validated):
            rows, rejected = sync.prepare_agri_rows(validated[as_of].payload)
            sync.apply_agri_rows(conn, rows)
            quarantined += rejected
        dates = [
            str(row[0])
            for row in conn.execute(
                f"SELECT DISTINCT date FROM {store.TABLE} ORDER BY date"
            )
        ]
        row_count = store.count_rows(conn)
    finally:
        conn.close()
    return BuildStats(
        as_of=dates[-1] if dates else None,
        rows=row_count,
        dates=dates,
        quarantined=quarantined,
    )


def _select_pairs(
    tag: str,
    from_date: str,
    *,
    assets_dir: Optional[Path],
    repo: str,
    token: Optional[str],
) -> list[sync.AssetPair]:
    if assets_dir is not None:
        assets = sync.list_local_assets(Path(assets_dir))
        tag_dates = [sync.asset_date(asset.name) for asset in assets]
    else:
        assets = sync.list_github_assets(repo=repo, token=token)
        tag_dates = [
            sync.asset_date(asset.name)
            for asset in assets if asset.release == tag
        ]
    tag_dates = [value for value in tag_dates if value is not None]
    if not tag_dates:
        raise MaterializeError(f"Release {tag} has no refresh assets")
    # Cumulative: the tag fixes the upper bound, while earlier monthly tags
    # supply the history that anchors 1W/1M/6M changes and comparisons.
    through = max(tag_dates)
    # Keep both halves of an agri pair: build_pairs rejects orphaned manifests.
    selected = [
        asset for asset in assets
        if (as_of := sync.asset_date(asset.name)) is not None
        and from_date <= as_of <= through
    ]
    pairs = [pair for pair in sync.build_pairs(selected) if pair.kind == "agri"]
    if not pairs:
        raise MaterializeError(f"No agri assets in {tag} from {from_date} onwards")
    return sorted(pairs, key=lambda pair: pair.as_of)


def run_materialize(
    *,
    tag: str,
    out: Path,
    from_date: str,
    cache_dir: Path = DEFAULT_CACHE_DIR,
    repo: str = DEFAULT_REPO,
    assets_dir: Optional[Path] = None,
    token: Optional[str] = None,
    dry_run: bool = False,
    force: bool = False,
) -> BuildStats:
    """Build a snapshot in a staging dir, then atomically replace ``out``."""
    if not sources.is_release_tag(tag):
        raise MaterializeError("--release-tag must look like data-YYYY-MM")
    try:
        date.fromisoformat(from_date)
    except ValueError as exc:
        raise MaterializeError(f"invalid --from date: {from_date}") from exc

    out = Path(out)
    if out.exists() and not (dry_run or force):
        raise MaterializeError(f"{out} already exists; pass --force to replace it")
    if not out.parent.is_dir():
        raise MaterializeError(f"output parent does not exist: {out.parent}")

    pairs = _select_pairs(
        tag, from_date, assets_dir=assets_dir, repo=repo, token=token
    )
    with tempfile.TemporaryDirectory(
        prefix=".agri-materialize-", dir=out.parent
    ) as work:
        workspace = Path(work)
        stage = workspace / "snapshot"
        stage.mkdir()
        # A dry run leaves no download cache behind; a real run reuses the
        # normal cache so a rebuild does not re-download every asset.
        download_cache = workspace / "cache" if dry_run else Path(cache_dir)
        paths = [
            sync._download_and_validate(pair, download_cache, token).path
            for pair in pairs
        ]
        stats = materialize_from_assets(paths, stage / sources.SNAPSHOT_DB_NAME)
        if dry_run:
            print(
                f"Dry run: {len(pairs)} agri day(s), {stats.rows} rows, "
                f"as_of={stats.as_of}; no writes."
            )
            return stats

        manifest = {
            "version": sources.MANIFEST_VERSION,
            "tag": tag,
            "status": "ready",
            "as_of": stats.as_of,
            "rows": stats.rows,
            "dates": stats.dates,
            "cumulative": True,
            "built_at": datetime.now(config.IST).isoformat(timespec="seconds"),
            "source_range": {"from": from_date, "to": stats.as_of},
        }
        # Written last: a snapshot is only advertised once everything else is
        # complete and the directory is moved into place.
        (stage / sources.MANIFEST_NAME).write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )

        backup: Optional[Path] = None
        if out.exists():
            backup = out.with_name(f".{out.name}.old-{os.getpid()}")
            os.replace(out, backup)
        try:
            os.replace(stage, out)
        except OSError:
            if backup is not None:
                os.replace(backup, out)
            raise
        if backup is not None:
            shutil.rmtree(backup)
    return stats


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Materialize a cumulative agri release snapshot."
    )
    parser.add_argument("--release-tag", required=True, help="data-YYYY-MM")
    parser.add_argument("--out", required=True, type=Path, help="snapshot directory")
    parser.add_argument(
        "--from", dest="from_date", required=True, help="first asset date (YYYY-MM-DD)"
    )
    parser.add_argument(
        "--cache-dir", type=Path, default=DEFAULT_CACHE_DIR,
        help="download cache (default: reports/refresh_assets)",
    )
    parser.add_argument(
        "--repo", default=os.getenv("GITHUB_REPOSITORY") or DEFAULT_REPO,
        help="GitHub OWNER/REPO (default: GITHUB_REPOSITORY or %(default)s)",
    )
    parser.add_argument(
        "--assets-dir", type=Path,
        help="read a release-shaped asset directory instead of GitHub",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="validate and count, write nothing"
    )
    parser.add_argument(
        "--force", action="store_true", help="replace an existing output directory"
    )
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    token = os.getenv("GITHUB_TOKEN") or os.getenv("GH_TOKEN")
    try:
        stats = run_materialize(
            tag=args.release_tag,
            out=args.out,
            from_date=args.from_date,
            cache_dir=args.cache_dir,
            repo=args.repo,
            assets_dir=args.assets_dir,
            token=token,
            dry_run=args.dry_run,
            force=args.force,
        )
    except (MaterializeError, sync.SyncError, OSError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    if not args.dry_run:
        print(
            f"Materialized {args.release_tag}: {stats.rows} rows, "
            f"{len(stats.dates)} dates, as_of={stats.as_of} -> {args.out}"
        )
        if stats.quarantined:
            print(f"Quarantined {stats.quarantined} row(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

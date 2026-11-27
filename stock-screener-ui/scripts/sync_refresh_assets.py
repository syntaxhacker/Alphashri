#!/usr/bin/env python3
"""Sync daily refresh assets from GitHub Releases into the local caches.

The scheduled GitHub Actions jobs publish compact, gzipped daily deltas as
flat release assets. Local packaged trees keep the directory-prefixed layout;
both spellings are accepted everywhere:

    52w/YYYY-MM-DD.json.gz    or YYYY-MM-DD.json.gz
    agri/YYYY-MM-DD.jsonl.gz  or YYYY-MM-DD.jsonl.gz
    manifests/52w-YYYY-MM-DD.json or 52w-YYYY-MM-DD.json
    manifests/agri-YYYY-MM-DD.json or agri-YYYY-MM-DD.json

This command downloads the selected assets, verifies each manifest's SHA256 and
row count, then applies the payload locally:

    agri rows  -> local SQLite (api.agri.store.upsert_rows)
    52W rows   -> local stock_52w_range table (change-only writes)
    52W rows   -> optional local Redis 52w_range:all
    any apply  -> local screener cache invalidation

No hosted backend and no Railway service is assumed. ``--assets-dir`` can be
used to consume a directory of assets instead of the GitHub API (tests/offline).

Examples:
    .venv/bin/python scripts/sync_refresh_assets.py --latest
    .venv/bin/python scripts/sync_refresh_assets.py --latest --dry-run
    .venv/bin/python scripts/sync_refresh_assets.py --release-tag data-2026-11

Range mode (``--from``/``--to``) remains available, chiefly for agri backfill.
A single rolling 52W asset cannot replay an in-month historical date.
"""

from __future__ import annotations

import argparse
import fcntl
import gzip
import hashlib
import hmac
import json
import math
import os
import re
import sqlite3
import sys
import urllib.error
import urllib.request
from collections import defaultdict
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable, Iterable, Optional
from zoneinfo import ZoneInfo

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from common.numbers import optional_float as _to_float
from trading.week52.upsert import upsert_52w_ranges

DEFAULT_REPO = "syntaxhacker/Alphashri"
DEFAULT_API_URL = "https://api.github.com"
DEFAULT_CACHE_DIR = PROJECT_ROOT / "reports" / "refresh_assets"
DEFAULT_STATE_FILE = PROJECT_ROOT / "reports" / "refresh_runs.json"
IST = ZoneInfo("Asia/Kolkata")

RELEASE_TAG_RE = re.compile(r"^data-\d{4}-\d{2}$")
# Releases upload flat filenames; packaging writes the prefixed tree. Matching
# is deliberately prefix-optional so both sources pair by (kind, date).
ASSET_PATTERNS: dict[str, re.Pattern[str]] = {
    "agri": re.compile(r"^(?:agri/)?(\d{4}-\d{2}-\d{2})\.jsonl\.gz$"),
    "52w": re.compile(r"^(?:52w/)?(\d{4}-\d{2}-\d{2})\.json\.gz$"),
}
MANIFEST_RE = re.compile(r"^(?:manifests/)?(agri|52w)-(\d{4}-\d{2}-\d{2})\.json$")

AGRI_NATURAL_KEY = ("date", "state", "district", "market", "commodity", "variety", "grade")


class SyncError(RuntimeError):
    """Base class for expected sync failures (reported without a traceback)."""


class SyncBusy(SyncError):
    """Another process already holds the state-file sync lock."""


class MissingAsset(SyncError):
    """An asset or its manifest is absent from the selected release(s)."""


class ManifestError(SyncError):
    """A manifest or payload is malformed or internally inconsistent."""


class ChecksumMismatch(SyncError):
    """The downloaded asset does not match the manifest SHA256."""


@dataclass(frozen=True)
class ReleaseAsset:
    """One downloadable file, either remote or inside ``--assets-dir``."""

    release: str
    name: str
    url: Optional[str] = None
    size: Optional[int] = None
    local_path: Optional[Path] = None
    updated_at: Optional[str] = None


@dataclass(frozen=True)
class AssetPair:
    """A daily payload and its manifest, keyed by kind and ISO date."""

    kind: str
    as_of: str
    release: str
    asset: ReleaseAsset
    manifest: ReleaseAsset


@dataclass
class ValidatedAsset:
    """A downloaded payload that passed manifest, hash and row-count checks."""

    kind: str
    as_of: str
    release: str
    path: Path
    manifest: dict[str, Any]
    payload: Any
    fingerprint: Optional[str] = None


@dataclass(frozen=True)
class RefreshPointer:
    """Latest published date and revision identity for one asset kind."""

    kind: str
    as_of: str
    fingerprint: str


@dataclass
class AppliedPointers:
    """Last applied date/fingerprint per kind, read from the run ledger."""

    week52_as_of: Optional[str] = None
    week52_fingerprint: Optional[str] = None
    agri_as_of: Optional[str] = None
    agri_fingerprint: Optional[str] = None


@dataclass
class SyncSummary:
    mode: str
    release_tags: list[str] = field(default_factory=list)
    agri_dates: list[str] = field(default_factory=list)
    week52_dates: list[str] = field(default_factory=list)
    agri_rows_verified: int = 0
    agri_rows_applied: int = 0
    agri_rows_quarantined: int = 0
    week52_symbols_verified: int = 0
    week52_added: int = 0
    week52_updated: int = 0
    week52_total: int = 0
    agri_max_date: Optional[str] = None
    agri_max_by_key: dict[str, str] = field(default_factory=dict)
    gap_warnings: list[str] = field(default_factory=list)
    redis_updated: bool = False
    screener_cache_keys_deleted: int = 0
    week52_fingerprint: Optional[str] = None
    agri_fingerprint: Optional[str] = None
    agri_error: Optional[str] = None
    dry_run: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "release_tags": self.release_tags,
            "agri_dates": self.agri_dates,
            "week52_dates": self.week52_dates,
            "agri_rows_verified": self.agri_rows_verified,
            "agri_rows_applied": self.agri_rows_applied,
            "agri_rows_quarantined": self.agri_rows_quarantined,
            "week52_symbols_verified": self.week52_symbols_verified,
            "week52_added": self.week52_added,
            "week52_updated": self.week52_updated,
            "week52_total": self.week52_total,
            "agri_max_date": self.agri_max_date,
            "agri_max_by_key": self.agri_max_by_key,
            "gap_warnings": self.gap_warnings,
            "redis_updated": self.redis_updated,
            "screener_cache_keys_deleted": self.screener_cache_keys_deleted,
            "week52_fingerprint": self.week52_fingerprint,
            "agri_fingerprint": self.agri_fingerprint,
            "agri_error": self.agri_error,
            "dry_run": self.dry_run,
        }


# ---------------------------------------------------------------------------
# Source discovery
# ---------------------------------------------------------------------------


def asset_name(kind: str, as_of: str) -> str:
    # Canonical local name: packaging and log messages depend on the prefix.
    # Matching (above) accepts flat release names in addition to this form.
    if kind == "agri":
        return f"agri/{as_of}.jsonl.gz"
    if kind == "52w":
        return f"52w/{as_of}.json.gz"
    raise ValueError(f"unknown asset kind: {kind}")


def manifest_name(kind: str, as_of: str) -> str:
    return f"manifests/{kind}-{as_of}.json"


def is_refresh_asset(name: str) -> bool:
    return bool(asset_date(name) or MANIFEST_RE.match(name))


def asset_date(name: str) -> Optional[str]:
    """Return the ISO date encoded in an asset or manifest name."""
    for pattern in ASSET_PATTERNS.values():
        match = pattern.match(name)
        if match:
            return match.group(1)
    match = MANIFEST_RE.match(name)
    if match:
        return match.group(2)
    return None


def asset_kind(name: str) -> Optional[str]:
    """Kind encoded in an asset/manifest name, or ``None`` for other files."""
    for kind, pattern in ASSET_PATTERNS.items():
        if pattern.match(name):
            return kind
    match = MANIFEST_RE.match(name)
    return match.group(1) if match else None


def refresh_fingerprint(asset: ReleaseAsset) -> str:
    """Stable identity for one asset revision; a date alone is not enough.

    Releases are re-uploaded with ``--clobber``, so the same session date can
    carry a different payload. GitHub exposes ``updated_at`` and ``size``;
    local fixtures use the file size and inode timestamp instead.
    """
    as_of = asset_date(asset.name) or ""
    if asset.local_path is not None:
        try:
            stat = asset.local_path.stat()
        except OSError:
            size, mtime_ns = asset.size, 0
        else:
            size = asset.size if asset.size is not None else stat.st_size
            mtime_ns = stat.st_mtime_ns
        raw = f"{as_of}|local|{size}|{mtime_ns}"
    else:
        size = asset.size if asset.size is not None else ""
        raw = f"{as_of}|{asset.updated_at or ''}|{size}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _github_request(url: str, token: Optional[str]) -> Any:
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "alphashri-refresh-sync",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:300]
        raise SyncError(f"GitHub API request failed ({exc.code}): {detail}") from exc
    except urllib.error.URLError as exc:
        raise SyncError(f"GitHub API request failed: {exc.reason}") from exc


def list_github_assets(
    repo: str = DEFAULT_REPO,
    token: Optional[str] = None,
    api_url: str = DEFAULT_API_URL,
) -> list[ReleaseAsset]:
    """List all assets in non-draft ``data-YYYY-MM`` releases."""
    assets: list[ReleaseAsset] = []
    page = 1
    while True:
        releases = _github_request(
            f"{api_url}/repos/{repo}/releases?per_page=100&page={page}",
            token,
        )
        if not isinstance(releases, list):
            raise SyncError("Unexpected GitHub releases response")
        for release in releases:
            tag = str(release.get("tag_name") or "")
            if release.get("draft") or not RELEASE_TAG_RE.match(tag):
                continue
            for item in release.get("assets", []):
                name = str(item.get("name") or "")
                if not is_refresh_asset(name):
                    continue
                assets.append(
                    ReleaseAsset(
                        release=tag,
                        name=name,
                        url=item.get("browser_download_url"),
                        size=item.get("size"),
                        updated_at=item.get("updated_at"),
                    )
                )
        if len(releases) < 100:
            break
        page += 1
    return assets


def list_local_assets(root: Path) -> list[ReleaseAsset]:
    """List a directory laid out like a release (used by tests/offline)."""
    root = Path(root)
    if not root.is_dir():
        raise MissingAsset(f"Assets directory not found: {root}")
    assets: list[ReleaseAsset] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        name = path.relative_to(root).as_posix()
        if is_refresh_asset(name):
            assets.append(
                ReleaseAsset(
                    release="local",
                    name=name,
                    local_path=path,
                    size=path.stat().st_size,
                )
            )
    return assets


def group_by_release(assets: Iterable[ReleaseAsset]) -> dict[str, list[ReleaseAsset]]:
    grouped: dict[str, list[ReleaseAsset]] = defaultdict(list)
    for asset in assets:
        grouped[asset.release].append(asset)
    return grouped


def build_pairs(assets: Iterable[ReleaseAsset]) -> list[AssetPair]:
    """Pair daily payloads with manifests and reject orphaned halves."""
    by_name = {asset.name: asset for asset in assets}
    found: dict[tuple[str, str], dict[str, ReleaseAsset]] = defaultdict(dict)

    for name, asset in by_name.items():
        for kind, pattern in ASSET_PATTERNS.items():
            match = pattern.match(name)
            if match:
                found[(kind, match.group(1))]["asset"] = asset
                break
        else:
            match = MANIFEST_RE.match(name)
            if match:
                found[(match.group(1), match.group(2))]["manifest"] = asset

    pairs: list[AssetPair] = []
    for (kind, as_of), halves in sorted(found.items(), key=lambda item: (item[0][1], item[0][0])):
        payload = halves.get("asset")
        manifest = halves.get("manifest")
        release = (payload or manifest).release  # type: ignore[union-attr]
        if payload is None:
            raise MissingAsset(
                f"Manifest {manifest_name(kind, as_of)} exists in {release} "
                f"but asset {asset_name(kind, as_of)} is missing"
            )
        if manifest is None:
            raise MissingAsset(
                f"Asset {asset_name(kind, as_of)} exists in {release} "
                f"but manifest {manifest_name(kind, as_of)} is missing"
            )
        pairs.append(
            AssetPair(
                kind=kind,
                as_of=as_of,
                release=release,
                asset=payload,
                manifest=manifest,
            )
        )
    return pairs


def choose_release_tags(
    available: Iterable[str],
    mode: str,
    release_tag: Optional[str] = None,
) -> list[str]:
    tags = sorted(available)
    if mode == "tag":
        if not release_tag:
            raise SyncError("--release-tag requires a tag")
        if release_tag not in tags:
            raise MissingAsset(f"Release {release_tag} not found (or has no refresh assets)")
        return [release_tag]
    if not tags:
        raise MissingAsset("No data-YYYY-MM releases with refresh assets found")
    if mode == "latest":
        # Keep the previous monthly tag too: a month rollover can leave the
        # newest agri asset in the prior release while 52W has already moved on.
        return tags[-2:]
    return tags


def select_pairs(
    pairs: Iterable[AssetPair],
    mode: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    allow_empty: bool = False,
) -> list[AssetPair]:
    selected = list(pairs)
    if mode == "latest":
        latest: list[AssetPair] = []
        for kind in ("agri", "52w"):
            kind_pairs = [pair for pair in selected if pair.kind == kind]
            if kind_pairs:
                latest.append(max(kind_pairs, key=lambda pair: pair.as_of))
        selected = latest
    elif mode == "range":
        if not from_date or not to_date:
            raise SyncError("Range mode requires --from and --to")
        selected = [
            pair for pair in selected if from_date <= pair.as_of <= to_date
        ]
    if not selected and not allow_empty:
        raise MissingAsset("No refresh assets matched the requested selection")
    return sorted(selected, key=lambda pair: (pair.as_of, pair.kind))


def materialize(
    asset: ReleaseAsset,
    cache_dir: Path,
    token: Optional[str] = None,
    force: bool = False,
) -> Path:
    """Return a local path for ``asset``, downloading it when necessary."""
    if asset.local_path is not None:
        if not asset.local_path.exists():
            raise MissingAsset(f"Asset not found: {asset.local_path}")
        return asset.local_path

    target = Path(cache_dir) / asset.release / asset.name
    if target.exists() and not force:
        return target
    if not asset.url:
        raise MissingAsset(f"No download URL for {asset.name}")
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + ".part")

    headers = {"User-Agent": "alphashri-refresh-sync"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(asset.url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            with temporary.open("wb") as handle:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    handle.write(chunk)
    except urllib.error.URLError as exc:
        temporary.unlink(missing_ok=True)
        raise SyncError(f"Download failed for {asset.name}: {exc.reason}") from exc
    os.replace(temporary, target)
    return target


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_manifest(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ManifestError(f"Cannot read manifest {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ManifestError(f"Manifest {path} is not a JSON object")
    return data


def _load_gzip_json(path: Path) -> Any:
    try:
        raw = gzip.decompress(Path(path).read_bytes())
    except (OSError, EOFError) as exc:
        raise ManifestError(f"Cannot gunzip {path}: {exc}") from exc
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ManifestError(f"Cannot parse {path}: {exc}") from exc


def _load_gzip_jsonl(path: Path) -> list[dict[str, Any]]:
    try:
        raw = gzip.decompress(Path(path).read_bytes()).decode("utf-8")
    except (OSError, EOFError) as exc:
        raise ManifestError(f"Cannot gunzip {path}: {exc}") from exc
    except UnicodeDecodeError as exc:
        raise ManifestError(f"{path} is not UTF-8: {exc}") from exc

    rows: list[dict[str, Any]] = []
    for line_number, line in enumerate(raw.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ManifestError(f"{path}:{line_number} is not JSON: {exc}") from exc
        if not isinstance(row, dict):
            raise ManifestError(f"{path}:{line_number} is not a JSON object")
        rows.append(row)
    return rows


def parse_iso_date(value: Any) -> str:
    """Normalise ``YYYY-MM-DD`` / ``DD/MM/YYYY`` / ``DD-MM-YYYY`` to ISO."""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value or "").strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    raise ManifestError(f"Invalid date: {value!r}")


def _agri_row_date(row: dict[str, Any]) -> Optional[str]:
    raw = row.get("date") or row.get("arrival_date")
    if raw is None:
        return None
    try:
        return parse_iso_date(raw)
    except ManifestError:
        return None


def _agri_commodity_key(row: dict[str, Any]) -> Optional[str]:
    from api.agri import registry

    key = row.get("commodity_key")
    if key:
        return str(key)
    for field_name in ("source_commodity", "commodity"):
        resolved = registry.commodity_key_for(row.get(field_name))
        if resolved:
            return resolved
    return None


def _agri_arrivals_present(rows: Iterable[dict[str, Any]]) -> bool:
    for row in rows:
        if row.get("arrivals_qtl") is not None or row.get("arrivals") is not None:
            return True
    return False


def _validate_52w_payload(
    payload: Any,
    as_of: str,
    manifest: dict[str, Any],
) -> int:
    if not isinstance(payload, dict):
        raise ManifestError("52W payload is not a JSON object")
    payload_as_of = payload.get("as_of")
    if not payload_as_of:
        raise ManifestError("52W payload is missing as_of")
    if parse_iso_date(payload_as_of) != as_of:
        raise ManifestError(
            f"52W payload as_of {payload_as_of!r} does not match asset date {as_of}"
        )
    symbols = payload.get("symbols")
    if not isinstance(symbols, dict):
        raise ManifestError("52W payload is missing a symbols object")
    count = payload.get("count")
    if not isinstance(count, int) or count < 0:
        raise ManifestError("52W payload count must be a non-negative integer")
    if count != len(symbols):
        raise ManifestError(
            f"52W payload count {count} does not match {len(symbols)} symbols"
        )
    for symbol, entry in symbols.items():
        if not isinstance(entry, dict):
            raise ManifestError(f"52W entry for {symbol} is not an object")
        for field_name in ("high", "low", "close"):
            value = entry.get(field_name)
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                raise ManifestError(f"52W entry for {symbol} has invalid {field_name}")
            # json.loads accepts NaN/Infinity; they must never reach SQLite/Redis.
            if not math.isfinite(float(value)):
                raise ManifestError(f"52W entry for {symbol} has non-finite {field_name}")
            if value <= 0:
                raise ManifestError(f"52W entry for {symbol} has non-positive {field_name}")
        if float(entry["high"]) < float(entry["low"]):
            raise ManifestError(f"52W entry for {symbol} has high < low")
        days_ago = entry.get("days_ago")
        if days_ago is not None and (not isinstance(days_ago, int) or days_ago < 0):
            raise ManifestError(f"52W entry for {symbol} has invalid days_ago")
    return count


def _validate_agri_payload(
    rows: list[dict[str, Any]],
    as_of: str,
    manifest: dict[str, Any],
) -> None:
    if not isinstance(manifest.get("arrivals_present"), bool):
        if "arrivals_present" in manifest:
            raise ManifestError("Agri manifest arrivals_present must be a boolean")
    else:
        computed_arrivals = _agri_arrivals_present(rows)
        if computed_arrivals != manifest["arrivals_present"]:
            raise ManifestError(
                "Agri manifest arrivals_present does not match the payload "
                f"({manifest['arrivals_present']} != {computed_arrivals})"
            )

    for index, row in enumerate(rows, start=1):
        row_date = _agri_row_date(row)
        if row_date is None:
            raise ManifestError(f"Agri row {index} has no valid date")
        if row_date != as_of:
            raise ManifestError(
                f"Agri row {index} date {row_date} does not match asset date {as_of}"
            )

    if "commodities" in manifest:
        expected = manifest["commodities"]
        computed = len(
            {
                key
                for row in rows
                if (key := _agri_commodity_key(row)) is not None
            }
        )
        if not isinstance(expected, int) or expected != computed:
            raise ManifestError(
                f"Agri manifest commodities {expected!r} does not match payload "
                f"({computed})"
            )


def validate_asset(pair: AssetPair, path: Path) -> ValidatedAsset:
    """Verify a payload against its manifest and return the parsed content."""
    manifest = _load_manifest(_manifest_path(pair))
    if manifest.get("kind") is not None and manifest.get("kind") != pair.kind:
        raise ManifestError(
            f"Manifest kind {manifest.get('kind')!r} does not match {pair.kind}"
        )
    manifest_as_of = manifest.get("as_of") or manifest.get("date")
    if not manifest_as_of:
        raise ManifestError("Manifest is missing as_of/date")
    if parse_iso_date(manifest_as_of) != pair.as_of:
        raise ManifestError(
            f"Manifest date {manifest_as_of!r} does not match asset date {pair.as_of}"
        )
    manifest_status = manifest.get("status")
    if manifest_status is not None and manifest_status != "complete":
        raise ManifestError(
            f"{pair.kind} {pair.as_of}: manifest status {manifest_status!r} is not complete"
        )

    expected_rows = manifest.get("rows", manifest.get("count"))
    if not isinstance(expected_rows, int) or expected_rows < 0:
        raise ManifestError("Manifest rows must be a non-negative integer")
    if pair.kind == "52w" and expected_rows == 0:
        raise ManifestError("52W asset has 0 symbols; refusing to apply an empty range set")
    expected_sha = manifest.get("sha256")
    if not isinstance(expected_sha, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", expected_sha):
        raise ManifestError("Manifest sha256 must be 64 hex characters")

    actual_sha = sha256_file(path)
    if not hmac.compare_digest(expected_sha.lower(), actual_sha):
        # Accept manifests produced by hashing the uncompressed payload as
        # well as the gzipped asset. The workflows hash the file on disk.
        try:
            uncompressed = gzip.decompress(path.read_bytes())
        except (OSError, EOFError):
            uncompressed = None
        uncompressed_sha = (
            hashlib.sha256(uncompressed).hexdigest() if uncompressed is not None else ""
        )
        if not hmac.compare_digest(expected_sha.lower(), uncompressed_sha):
            raise ChecksumMismatch(
                f"{pair.kind} {pair.as_of}: checksum {actual_sha} != manifest "
                f"{expected_sha}"
            )

    if pair.kind == "agri":
        payload = _load_gzip_jsonl(path)
        if len(payload) != expected_rows:
            raise ManifestError(
                f"Agri manifest rows {expected_rows} does not match payload ({len(payload)})"
            )
        _validate_agri_payload(payload, pair.as_of, manifest)
    else:
        payload = _load_gzip_json(path)
        count = _validate_52w_payload(payload, pair.as_of, manifest)
        if count != expected_rows:
            raise ManifestError(
                f"52W manifest rows {expected_rows} does not match payload ({count})"
            )

    return ValidatedAsset(
        kind=pair.kind,
        as_of=pair.as_of,
        release=pair.release,
        path=path,
        manifest=manifest,
        payload=payload,
        fingerprint=refresh_fingerprint(pair.asset),
    )


def _manifest_path(pair: AssetPair) -> Path:
    manifest = pair.manifest
    if manifest.local_path is not None:
        return manifest.local_path
    # populates later during download; callers materialize the manifest first
    raise SyncError("Manifest has not been materialized")


# ---------------------------------------------------------------------------
# Apply
# ---------------------------------------------------------------------------


def normalize_agri_row(row: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Map a collector row onto the local SQLite store columns.

    Unknown keys are dropped. ``api.agri.store.upsert_rows`` still owns the
    COALESCE/source-priority rules; this function only normalises aliases and
    derives ``commodity_key`` when the collector omitted it.
    """
    from api.agri import registry, store

    raw_date = row.get("date") or row.get("arrival_date")
    if raw_date is None:
        return None
    try:
        iso_date = parse_iso_date(raw_date)
    except ManifestError:
        return None

    source_commodity = row.get("source_commodity") or row.get("commodity")
    key = _agri_commodity_key(row)
    if not key or key not in registry.valid_keys():
        return None

    commodity = row.get("commodity") or source_commodity or registry.label_for(key)
    out: dict[str, Any] = {
        "date": iso_date,
        "state": row.get("state") or "",
        "district": row.get("district") or "",
        "market": row.get("market") or "",
        "commodity": commodity or "",
        "commodity_key": key,
        "variety": row.get("variety") or "",
        "grade": row.get("grade") or "",
        "min_price": _to_float(row.get("min_price")),
        "max_price": _to_float(row.get("max_price")),
        "modal_price": _to_float(row.get("modal_price")),
        "arrivals_qtl": _to_float(row.get("arrivals_qtl", row.get("arrivals"))),
        "price_unit": row.get("price_unit") or registry.PRICE_UNIT,
        "source": row.get("source") or row.get("price_source") or registry.SOURCE_DAILY,
    }
    # Future-proof: if the store grows columns (source_commodity, product_form,
    # arrival_units, ...) and the collector emits them, pass them through.
    for column in store.COLUMNS:
        if column in row and column not in out:
            out[column] = row[column]
    return {column: out.get(column) for column in store.COLUMNS}


def _valid_price_triple(row: dict[str, Any]) -> bool:
    values = [row.get("min_price"), row.get("modal_price"), row.get("max_price")]
    present = [value for value in values if value is not None]
    if any(value <= 0 for value in present):
        return False
    if len(present) == 3 and not (values[0] <= values[1] <= values[2]):
        return False
    return True


def prepare_agri_rows(raw_rows: Iterable[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    """Normalise, quarantine and de-duplicate one day of agri rows.

    Returns ``(rows, quarantined)``. The natural key deliberately mirrors the
    SQLite UNIQUE constraint so a replay is idempotent.
    """
    cleaned: dict[tuple[Any, ...], dict[str, Any]] = {}
    quarantined = 0
    for raw in raw_rows:
        row = normalize_agri_row(raw)
        if row is None or not _valid_price_triple(row):
            quarantined += 1
            continue
        key = tuple(row.get(column) for column in AGRI_NATURAL_KEY)
        cleaned[key] = row
    return list(cleaned.values()), quarantined


def apply_agri_rows(conn: sqlite3.Connection, rows: Iterable[dict[str, Any]]) -> int:
    """Upsert rows through the existing store (COALESCE rules live there)."""
    from api.agri import store

    return store.upsert_rows(conn, rows)


def open_agri_db(path: Optional[Path] = None) -> sqlite3.Connection:
    from api.agri import store

    return store.open_writer(path)


def agri_max_date(conn: sqlite3.Connection) -> Optional[str]:
    from api.agri import store

    value = conn.execute(f"SELECT MAX(date) FROM {store.TABLE}").fetchone()[0]
    return str(value) if value else None


def agri_max_dates_by_key(conn: sqlite3.Connection) -> dict[str, str]:
    """Per-commodity latest date: a partial day must not advance every key."""
    from api.agri import store

    rows = conn.execute(
        f"SELECT commodity_key, MAX(date) FROM {store.TABLE} "
        "GROUP BY commodity_key ORDER BY commodity_key"
    )
    return {str(key): str(value) for key, value in rows if key and value}


def agri_gap_warnings(
    conn: sqlite3.Connection,
    *,
    min_missing_days: int = 8,
    limit: int = 10,
) -> list[str]:
    """Report large holes in the local agri date series (default >7 days)."""
    from api.agri import store

    values = [
        str(row[0])
        for row in conn.execute(f"SELECT DISTINCT date FROM {store.TABLE} ORDER BY date")
    ]
    parsed: list[date] = []
    for value in values:
        try:
            parsed.append(date.fromisoformat(value))
        except ValueError:
            continue
    warnings: list[str] = []
    for previous, current in zip(parsed, parsed[1:]):
        missing = (current - previous).days - 1
        if missing >= min_missing_days:
            warnings.append(
                f"agri gap: {previous.isoformat()} -> {current.isoformat()} "
                f"({missing} days missing)"
            )
    return warnings[-limit:]


def apply_52w_data(
    session_factory: Callable[[], Any],
    data: dict[str, Any],
) -> tuple[int, int]:
    """Change-only upsert of a validated 52W payload into stock_52w_range."""
    symbols = data.get("symbols") or {}
    if not isinstance(symbols, dict) or not symbols:
        return 0, 0
    return upsert_52w_ranges(session_factory, symbols)


def count_52w(session_factory: Callable[[], Any]) -> int:
    from db.models.stock_52w_touch import Stock52WeekRange

    session = session_factory()
    try:
        return int(session.query(Stock52WeekRange).count())
    finally:
        session.close()


def load_52w_snapshot(session_factory: Callable[[], Any]) -> dict[str, dict[str, Any]]:
    """Full DB snapshot for the bulk Redis key (DB is the source of truth)."""
    from db.models.stock_52w_touch import Stock52WeekRange

    session = session_factory()
    try:
        rows = session.query(Stock52WeekRange).all()
        return {
            row.symbol: {
                "high": row.high_52w,
                "low": row.low_52w,
                "close": row.close,
                "days_ago": row.days_ago,
                "updated_at": row.updated_at.isoformat() if row.updated_at else None,
            }
            for row in rows
        }
    finally:
        session.close()


def update_local_redis(
    data: dict[str, Any],
    *,
    replace: bool = False,
) -> tuple[bool, int]:
    """Refresh ``52w_range:all`` and invalidate screener keys when Redis exists.

    A missing local Redis is not an error: the SQLite tables are the source of
    truth. ``replace`` writes a complete DB snapshot instead of merging a delta,
    so a small smoke-test run can never leave the bulk key partial.

    Returns ``(bulk_updated, screener_keys_deleted)``.
    """
    try:
        from cache.redis_client import (
            cache_get,
            cache_set,
            get_redis_client,
            invalidate_screener_cache,
        )
        from cache.week52 import resolve_ttl
        from trading.week52.keys import BULK
    except Exception:
        return False, 0

    if get_redis_client() is None:
        return False, 0

    bulk_updated = False
    if data:
        if replace:
            payload = dict(data)
        else:
            existing = cache_get(BULK)
            payload = dict(existing) if isinstance(existing, dict) else {}
            payload.update(data)
        bulk_updated = bool(cache_set(BULK, payload, ttl=resolve_ttl()))

    try:
        deleted = int(invalidate_screener_cache())
    except Exception:
        deleted = 0
    return bulk_updated, deleted


def append_state(path: Path, record: dict[str, Any], keep: int = 50) -> None:
    path = Path(path)
    existing: list[Any] = []
    if path.exists():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded, list):
                existing = loaded
        except (OSError, json.JSONDecodeError):
            existing = []
    existing.append(record)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(
        json.dumps(existing[-keep:], indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, path)


def latest_52w_as_of(
    repo: str = DEFAULT_REPO,
    token: Optional[str] = None,
    api_url: str = DEFAULT_API_URL,
) -> str | None:
    """Newest 52W asset date published across all ``data-YYYY-MM`` releases."""
    pattern = ASSET_PATTERNS["52w"]
    dates: list[str] = []
    for asset in list_github_assets(repo=repo, token=token, api_url=api_url):
        match = pattern.match(asset.name)
        if match:
            dates.append(match.group(1))
    return max(dates) if dates else None


def _latest_fingerprint(pairs: Iterable[AssetPair], kind: str) -> Optional[str]:
    """Fingerprint of the newest selected pair of one kind (mirrors ``select_pairs``)."""
    candidates = [pair for pair in pairs if pair.kind == kind]
    if not candidates:
        return None
    return refresh_fingerprint(max(candidates, key=lambda pair: pair.as_of).asset)


def latest_refresh_pointers(
    repo: str = DEFAULT_REPO,
    token: Optional[str] = None,
    api_url: str = DEFAULT_API_URL,
) -> dict[str, RefreshPointer]:
    """Latest date + fingerprint per kind from ONE GitHub listing pass.

    Selecting through the same pair machinery as ``run_sync(mode='latest')``
    keeps the watcher's pointer in step with what a successful sync records.
    """
    assets = list_github_assets(repo=repo, token=token, api_url=api_url)
    if not assets:
        return {}
    grouped = group_by_release(assets)
    tags = choose_release_tags(grouped, "latest")
    pairs: list[AssetPair] = []
    for tag in tags:
        # Mirror run_sync's per-kind pairing so the pointer matches what an
        # apply would actually select; a half-uploaded kind cannot block the
        # other one.
        for kind in ("52w", "agri"):
            subset = [a for a in grouped[tag] if asset_kind(a.name) == kind]
            try:
                pairs.extend(build_pairs(subset))
            except MissingAsset:
                continue
    selected = select_pairs(pairs, "latest", allow_empty=True)
    return {
        pair.kind: RefreshPointer(
            kind=pair.kind,
            as_of=pair.as_of,
            fingerprint=refresh_fingerprint(pair.asset),
        )
        for pair in selected
    }


def last_applied_pointers(state_file: Path = DEFAULT_STATE_FILE) -> AppliedPointers:
    """Last applied date and fingerprint for each kind from the run ledger.

    ``partial`` records count: a failed agri apply still advances 52W. Older
    ledgers without fingerprints yield an unknown fingerprint (and therefore
    one catch-up apply) while keeping their date for rollback protection.
    """
    result = AppliedPointers()
    try:
        records = json.loads(Path(state_file).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return result
    if not isinstance(records, list):
        return result
    for record in reversed(records):
        if not isinstance(record, dict) or record.get("status") not in ("ok", "partial"):
            continue
        if result.week52_as_of is None or result.week52_fingerprint is None:
            dates = [
                value
                for value in (record.get("week52_dates") or [])
                if isinstance(value, str) and value
            ]
            if result.week52_as_of is None and dates:
                result.week52_as_of = max(dates)
            fingerprint = record.get("week52_fingerprint")
            if result.week52_fingerprint is None and isinstance(fingerprint, str) and fingerprint:
                result.week52_fingerprint = fingerprint
        if result.agri_as_of is None or result.agri_fingerprint is None:
            dates = [
                value
                for value in (record.get("agri_dates") or [])
                if isinstance(value, str) and value
            ]
            if result.agri_as_of is None and dates:
                result.agri_as_of = max(dates)
            fingerprint = record.get("agri_fingerprint")
            if result.agri_fingerprint is None and isinstance(fingerprint, str) and fingerprint:
                result.agri_fingerprint = fingerprint
        if all(
            value is not None
            for value in (
                result.week52_as_of,
                result.week52_fingerprint,
                result.agri_as_of,
                result.agri_fingerprint,
            )
        ):
            break
    return result


def last_applied_fingerprints(state_file: Path = DEFAULT_STATE_FILE) -> dict[str, Optional[str]]:
    """Last applied fingerprint per kind (``agri`` / ``52w``)."""
    applied = last_applied_pointers(state_file)
    return {"agri": applied.agri_fingerprint, "52w": applied.week52_fingerprint}


def last_applied_52w_as_of(state_file: Path = DEFAULT_STATE_FILE) -> str | None:
    """Newest 52W date in the last successful sync ledger record, if any."""
    return last_applied_pointers(state_file).week52_as_of


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def _download_and_validate(
    pair: AssetPair,
    cache_dir: Path,
    token: Optional[str],
) -> ValidatedAsset:
    manifest_asset = pair.manifest
    manifest_is_remote = manifest_asset.local_path is None

    def _attach_manifest(force: bool = False) -> AssetPair:
        nonlocal pair
        if not manifest_is_remote:
            return pair
        manifest_path = materialize(manifest_asset, cache_dir, token=token, force=force)
        pair = AssetPair(
            kind=pair.kind,
            as_of=pair.as_of,
            release=pair.release,
            asset=pair.asset,
            manifest=ReleaseAsset(
                release=manifest_asset.release,
                name=manifest_asset.name,
                url=manifest_asset.url,
                size=manifest_asset.size,
                local_path=manifest_path,
            ),
        )
        return pair

    # Releases are re-uploaded with --clobber. A cached manifest and asset from
    # an older revision match each other, so a checksum check alone cannot spot
    # the stale pair — refresh the small manifest first to get the current SHA.
    _attach_manifest(force=manifest_is_remote)
    payload_path = materialize(pair.asset, cache_dir, token=token)
    try:
        return validate_asset(pair, payload_path)
    except ChecksumMismatch:
        if pair.asset.local_path is not None:
            raise
        _attach_manifest(force=True)
        payload_path = materialize(pair.asset, cache_dir, token=token, force=True)
        return validate_asset(pair, payload_path)


def _default_session_factory() -> Callable[[], Any]:
    from db.database import SessionLocal

    return SessionLocal


@contextmanager
def _state_lock(state_file: Optional[Path], lock: bool):
    """Non-blocking cross-process guard derived from the ledger path."""
    if state_file is None or not lock:
        yield
        return
    path = Path(f"{state_file}.lock")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+") as handle:
        acquired = False
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            acquired = True
        except OSError as exc:
            raise SyncBusy(f"Sync already running (lock: {path})") from exc
        try:
            yield
        finally:
            if acquired:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def run_sync(
    *,
    mode: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    release_tag: Optional[str] = None,
    repo: str = DEFAULT_REPO,
    token: Optional[str] = None,
    api_url: str = DEFAULT_API_URL,
    assets_dir: Optional[Path] = None,
    cache_dir: Path = DEFAULT_CACHE_DIR,
    agri_db_path: Optional[Path] = None,
    session_factory: Optional[Callable[[], Any]] = None,
    dry_run: bool = False,
    use_redis: bool = True,
    state_file: Optional[Path] = DEFAULT_STATE_FILE,
    allow_empty: bool = False,
    lock: bool = True,
) -> SyncSummary:
    """Download, validate and apply one selection of refresh assets."""
    with _state_lock(state_file, lock):
        return _run_sync_unlocked(
            mode=mode,
            from_date=from_date,
            to_date=to_date,
            release_tag=release_tag,
            repo=repo,
            token=token,
            api_url=api_url,
            assets_dir=assets_dir,
            cache_dir=cache_dir,
            agri_db_path=agri_db_path,
            session_factory=session_factory,
            dry_run=dry_run,
            use_redis=use_redis,
            state_file=state_file,
            allow_empty=allow_empty,
        )


def _run_sync_unlocked(
    *,
    mode: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    release_tag: Optional[str] = None,
    repo: str = DEFAULT_REPO,
    token: Optional[str] = None,
    api_url: str = DEFAULT_API_URL,
    assets_dir: Optional[Path] = None,
    cache_dir: Path = DEFAULT_CACHE_DIR,
    agri_db_path: Optional[Path] = None,
    session_factory: Optional[Callable[[], Any]] = None,
    dry_run: bool = False,
    use_redis: bool = True,
    state_file: Optional[Path] = DEFAULT_STATE_FILE,
    allow_empty: bool = False,
) -> SyncSummary:
    if mode not in {"latest", "range", "tag"}:
        raise SyncError(f"Unknown sync mode: {mode}")

    if assets_dir is not None:
        all_assets = list_local_assets(Path(assets_dir))
    else:
        all_assets = list_github_assets(repo=repo, token=token, api_url=api_url)

    if not all_assets and allow_empty:
        summary = SyncSummary(mode=mode, dry_run=dry_run)
        if state_file is not None and not dry_run:
            append_state(
                Path(state_file),
                {
                    "timestamp": datetime.now(IST).isoformat(timespec="seconds"),
                    "status": "empty",
                    **summary.as_dict(),
                },
            )
        print("No refresh assets found (allowed empty).")
        return summary

    grouped = group_by_release(all_assets)
    tags = choose_release_tags(grouped, mode, release_tag=release_tag)

    pairs: list[AssetPair] = []
    agri_error: Optional[str] = None
    for tag in tags:
        release_assets = grouped[tag]
        if mode == "range":
            assert from_date and to_date
            release_assets = [
                asset
                for asset in release_assets
                if (as_of := asset_date(asset.name)) is not None
                and from_date <= as_of <= to_date
            ]
        pairs.extend(build_pairs([a for a in release_assets if asset_kind(a.name) == "52w"]))
        try:
            pairs.extend(build_pairs([a for a in release_assets if asset_kind(a.name) == "agri"]))
        except MissingAsset as exc:
            # An incomplete agri upload must not stop the 52W apply.
            agri_error = str(exc)

    selected = select_pairs(
        pairs,
        mode,
        from_date=from_date,
        to_date=to_date,
        allow_empty=allow_empty,
    )

    summary = SyncSummary(
        mode=mode,
        release_tags=sorted({pair.release for pair in selected}),
        week52_fingerprint=_latest_fingerprint(selected, "52w"),
        agri_fingerprint=_latest_fingerprint(selected, "agri"),
        dry_run=dry_run,
    )

    # 52W first: a bad agri asset must never block the range update.
    week52_assets = [
        _download_and_validate(pair, Path(cache_dir), token)
        for pair in selected
        if pair.kind == "52w"
    ]
    agri_assets: list[ValidatedAsset] = []
    if not agri_error:
        for pair in selected:
            if pair.kind != "agri":
                continue
            try:
                agri_assets.append(_download_and_validate(pair, Path(cache_dir), token))
            except Exception as exc:
                agri_error = str(exc)
                break
    if agri_error:
        summary.agri_error = agri_error
        summary.agri_fingerprint = None

    agri_assets.sort(key=lambda item: item.as_of)
    week52_assets.sort(key=lambda item: item.as_of)
    summary.agri_dates = [] if agri_error else [item.as_of for item in agri_assets]
    summary.week52_dates = [item.as_of for item in week52_assets]
    summary.agri_rows_verified = sum(len(item.payload) for item in agri_assets)
    summary.week52_symbols_verified = sum(
        int(item.payload.get("count", 0)) for item in week52_assets
    )

    if dry_run:
        if agri_assets:
            from api.agri import store

            conn = store.open_reader(agri_db_path)
            if conn is not None:
                try:
                    summary.agri_max_date = agri_max_date(conn)
                finally:
                    conn.close()
        print(
            f"Dry run: {len(agri_assets)} agri day(s), "
            f"{len(week52_assets)} 52W day(s) validated; no writes."
        )
        return summary

    combined_52w: dict[str, Any] = {}
    factory: Optional[Callable[[], Any]] = None
    for item in week52_assets:
        combined_52w.update(item.payload.get("symbols") or {})
    if combined_52w:
        factory = session_factory or _default_session_factory()
        added, updated = apply_52w_data(factory, {"symbols": combined_52w})
        summary.week52_added = added
        summary.week52_updated = updated
        summary.week52_total = count_52w(factory)

    applied_rows = 0
    quarantined_rows = 0
    if agri_assets and not agri_error:
        try:
            conn = open_agri_db(agri_db_path)
            try:
                for item in agri_assets:
                    rows, quarantined = prepare_agri_rows(item.payload)
                    applied_rows += apply_agri_rows(conn, rows)
                    quarantined_rows += quarantined
                summary.agri_max_date = agri_max_date(conn)
                summary.agri_max_by_key = agri_max_dates_by_key(conn)
                summary.gap_warnings = agri_gap_warnings(conn)
            finally:
                conn.close()
        except Exception as exc:
            agri_error = str(exc)
            summary.agri_error = agri_error
            # Keep the failed revision "unapplied" so the next poll retries it.
            summary.agri_fingerprint = None
            summary.agri_dates = []
    summary.agri_rows_applied = applied_rows
    summary.agri_rows_quarantined = quarantined_rows

    if use_redis and (agri_assets or combined_52w):
        redis_payload: dict[str, Any] = {}
        if combined_52w and factory is not None:
            redis_payload = load_52w_snapshot(factory)
        summary.redis_updated, summary.screener_cache_keys_deleted = update_local_redis(
            redis_payload,
            replace=bool(redis_payload),
        )

    if state_file is not None:
        record = {
            "timestamp": datetime.now(IST).isoformat(timespec="seconds"),
            "status": "partial" if agri_error else "ok",
            **summary.as_dict(),
        }
        append_state(Path(state_file), record)

    return summary


def _print_summary(summary: SyncSummary) -> None:
    print(
        f"Synced {len(summary.agri_dates)} agri day(s): "
        f"{summary.agri_rows_applied} rows applied"
        + (
            f", {summary.agri_rows_quarantined} quarantined"
            if summary.agri_rows_quarantined
            else ""
        )
    )
    print(
        f"52W: {len(summary.week52_dates)} day(s), "
        f"{summary.week52_symbols_verified} symbols verified, "
        f"+{summary.week52_added} ~{summary.week52_updated} "
        f"({summary.week52_total} local rows)"
    )
    if summary.agri_max_date:
        print(f"Agri MAX(date): {summary.agri_max_date}")
    if summary.agri_max_by_key:
        print(
            "Agri MAX(date) by key: "
            + ", ".join(
                f"{key}={value}" for key, value in summary.agri_max_by_key.items()
            )
        )
    for warning in summary.gap_warnings:
        print(f"WARNING: {warning}")
    if summary.agri_error:
        print(f"Agri error: {summary.agri_error}")
    if summary.redis_updated:
        print(
            "Redis: 52w_range:all refreshed, "
            f"{summary.screener_cache_keys_deleted} screener key(s) invalidated"
        )
    elif summary.screener_cache_keys_deleted:
        print(
            f"Redis: {summary.screener_cache_keys_deleted} screener key(s) invalidated"
        )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Download and apply GitHub Release refresh assets locally."
    )
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument(
        "--latest",
        action="store_true",
        help="Apply the newest agri and 52W assets in the latest monthly release",
    )
    selection.add_argument(
        "--release-tag",
        help="Apply every asset in one release (for example data-2026-11)",
    )
    selection.add_argument(
        "--from",
        dest="from_date",
        help="First asset date (YYYY-MM-DD); use with --to",
    )
    parser.add_argument("--to", dest="to_date", help="Last asset date (YYYY-MM-DD)")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Download and validate, but write no DB/Redis/state",
    )
    parser.add_argument(
        "--repo",
        default=os.getenv("GITHUB_REPOSITORY") or DEFAULT_REPO,
        help="GitHub OWNER/REPO (default: GITHUB_REPOSITORY or %(default)s)",
    )
    parser.add_argument(
        "--assets-dir",
        type=Path,
        help="Read assets from a local release-shaped directory instead of GitHub",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=DEFAULT_CACHE_DIR,
        help="Download cache (default: reports/refresh_assets)",
    )
    parser.add_argument(
        "--agri-db",
        type=Path,
        default=None,
        help="Agri SQLite path (default: api.agri.store default)",
    )
    parser.add_argument(
        "--state-file",
        type=Path,
        default=DEFAULT_STATE_FILE,
        help="JSON run ledger (default: reports/refresh_runs.json)",
    )
    parser.add_argument(
        "--no-redis",
        action="store_true",
        help="Do not touch local Redis (SQLite remains the source of truth)",
    )
    parser.add_argument(
        "--allow-empty",
        action="store_true",
        help="Succeed when no assets match (holiday/no-op)",
    )
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.from_date or args.to_date:
        if not (args.from_date and args.to_date):
            parser.error("--from and --to must be provided together")
        try:
            start = date.fromisoformat(args.from_date)
            end = date.fromisoformat(args.to_date)
        except ValueError as exc:
            parser.error(f"invalid date: {exc}")
        if start > end:
            parser.error("--from must be on or before --to")
        mode = "range"
    elif args.release_tag:
        mode = "tag"
    else:
        mode = "latest"

    token = os.getenv("GITHUB_TOKEN") or os.getenv("GH_TOKEN")

    try:
        summary = run_sync(
            mode=mode,
            from_date=args.from_date,
            to_date=args.to_date,
            release_tag=args.release_tag,
            repo=args.repo,
            token=token,
            assets_dir=args.assets_dir,
            cache_dir=args.cache_dir,
            agri_db_path=args.agri_db,
            dry_run=args.dry_run,
            use_redis=not args.no_redis,
            state_file=args.state_file,
            allow_empty=args.allow_empty,
        )
    except SyncError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    _print_summary(summary)
    if summary.agri_error:
        print(f"ERROR: agri sync failed: {summary.agri_error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

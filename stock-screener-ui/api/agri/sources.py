"""Discovery of agri price sources: the local cache and release snapshots.

Only ``local`` and ``release:<data-YYYY-MM>`` ids exist. A release is advertised
when its directory holds a valid ``manifest.json`` and a non-empty SQLite file
inside that same directory. No GET downloads, writes or migrates anything, and a
manifest is never allowed to point at an arbitrary path.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Optional

import config

from . import store

LOCAL_ID: str = "local"
RELEASE_PREFIX: str = "release:"
RELEASE_TAG_RE: re.Pattern[str] = re.compile(r"^data-\d{4}-\d{2}$")
MANIFEST_NAME: str = "manifest.json"
SNAPSHOT_DB_NAME: str = "agri_prices.db"
MANIFEST_VERSION: int = 1
DEFAULT_RELEASES_ROOT: Path = store.ROOT / "reports" / "agri" / "releases"


class UnknownSource(ValueError):
    """The requested source is malformed or has no valid ready snapshot."""


@dataclass(frozen=True)
class SourceInfo:
    id: str
    label: str
    dataset: Optional[str]
    as_of: Optional[str]
    rows: int
    status: str = "ready"
    path: Optional[Path] = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "dataset": self.dataset,
            "as_of": self.as_of,
            "rows": self.rows,
            "status": self.status,
        }


def releases_root() -> Path:
    override = os.getenv("AGRI_RELEASES_ROOT")
    return Path(override) if override else DEFAULT_RELEASES_ROOT


def local_source(path: Optional[str | Path] = None) -> SourceInfo:
    """The local cache is always a selectable source, even when it is missing."""
    target = Path(path) if path is not None else store.default_db_path()
    as_of: Optional[str] = None
    rows = 0
    try:
        conn = store.open_reader(target)
    except (OSError, sqlite3.Error):
        conn = None
    if conn is not None:
        try:
            as_of = store.latest_date(conn)
            rows = store.count_rows(conn)
        except sqlite3.Error:
            as_of, rows = None, 0
        finally:
            conn.close()
    return SourceInfo(
        id=LOCAL_ID, label="Local cache", dataset=None,
        as_of=str(as_of) if as_of else None, rows=rows,
        path=target,
    )


def is_release_tag(tag: Any) -> bool:
    return isinstance(tag, str) and bool(RELEASE_TAG_RE.fullmatch(tag))


def _manifest_source(directory: Path, root: Path, manifest: dict[str, Any]) -> SourceInfo:
    tag = manifest.get("tag")
    if not is_release_tag(tag) or tag != directory.name:
        raise ValueError("tag does not match its directory")
    if manifest.get("version") != MANIFEST_VERSION or isinstance(manifest.get("version"), bool):
        raise ValueError("unsupported manifest version")
    if manifest.get("status") != "ready":
        raise ValueError("manifest is not ready")
    if manifest.get("cumulative") is not True:
        raise ValueError("manifest is not cumulative")

    as_of = manifest.get("as_of")
    if as_of is not None:
        try:
            as_of = date.fromisoformat(str(as_of)).isoformat()
        except ValueError as exc:
            raise ValueError("invalid as_of") from exc
    dates_value = manifest.get("dates")
    if not isinstance(dates_value, list):
        raise ValueError("manifest dates must be a list")
    dates: list[str] = []
    for value in dates_value:
        try:
            dates.append(date.fromisoformat(str(value)).isoformat())
        except ValueError as exc:
            raise ValueError("invalid date in dates") from exc
    if dates:
        if as_of is None or as_of != max(dates):
            raise ValueError("as_of does not match dates")
    rows = manifest.get("rows")
    if not isinstance(rows, int) or isinstance(rows, bool) or rows < 0:
        raise ValueError("invalid row count")
    built_at = manifest.get("built_at")
    if not isinstance(built_at, str) or not built_at.strip():
        raise ValueError("missing built_at")
    source_range = manifest.get("source_range")
    if not isinstance(source_range, dict):
        raise ValueError("missing source_range")

    # A released tag cannot describe a period that has not happened yet; a
    # future as_of would otherwise be shown as a trustworthy fresh snapshot.
    today = datetime.now(config.IST).date()
    if date(int(tag[5:9]), int(tag[10:12]), 1) > today.replace(day=1):
        raise ValueError("release tag is in the future")
    if as_of and date.fromisoformat(as_of) > today:
        raise ValueError("snapshot as_of is in the future")

    # The DB location is derived from the validated tag, never read from the
    # manifest: a manifest cannot smuggle an arbitrary path into the reader.
    db_path = directory / SNAPSHOT_DB_NAME
    if db_path.is_symlink() or not db_path.is_file():
        raise ValueError("snapshot DB is missing")
    resolved = db_path.resolve()
    if resolved.parent != directory.resolve() or root.resolve() not in resolved.parents:
        raise ValueError("snapshot DB is outside its release directory")
    if resolved.stat().st_size <= 0:
        raise ValueError("snapshot DB is empty")

    return SourceInfo(
        id=f"{RELEASE_PREFIX}{tag}", label=f"Release {tag}", dataset=tag,
        as_of=as_of, rows=rows, path=db_path,
    )


def discover(
    root: Optional[str | Path] = None,
    *,
    local_path: Optional[str | Path] = None,
) -> list[SourceInfo]:
    """List the local source followed by every valid release snapshot."""
    sources = [local_source(local_path)]
    base = Path(root) if root is not None else releases_root()
    if not base.is_dir():
        return sources
    try:
        entries = sorted(base.iterdir(), key=lambda item: item.name)
    except OSError:
        return sources
    for directory in entries:
        if directory.is_symlink() or not directory.is_dir() or not is_release_tag(directory.name):
            continue
        manifest_path = directory / MANIFEST_NAME
        if manifest_path.is_symlink() or not manifest_path.is_file():
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            continue
        if not isinstance(manifest, dict):
            continue
        try:
            sources.append(_manifest_source(directory, base, manifest))
        except (ValueError, OSError):
            continue
    return sources


def resolve(
    source: Optional[str],
    *,
    local_path: Optional[str | Path] = None,
    root: Optional[str | Path] = None,
) -> SourceInfo:
    """Resolve a source id, rejecting paths, unknown tags and broken snapshots."""
    requested = LOCAL_ID if source is None else source
    if not isinstance(requested, str) or not requested.strip():
        raise UnknownSource(f"unknown source {requested!r}; valid sources: {LOCAL_ID}")
    value = requested.strip()
    if value.casefold() == LOCAL_ID:
        return local_source(local_path)
    if not value.startswith(RELEASE_PREFIX):
        raise UnknownSource(
            f"unknown source {requested!r}; valid sources: '{LOCAL_ID}' or "
            f"'{RELEASE_PREFIX}<data-YYYY-MM>' (no paths)"
        )
    tag = value[len(RELEASE_PREFIX):]
    if not is_release_tag(tag):
        raise UnknownSource(
            f"unknown source {requested!r}; release ids must be "
            f"'{RELEASE_PREFIX}<data-YYYY-MM>' (no paths)"
        )
    available = discover(root, local_path=local_path)
    for info in available:
        if info.id == value:
            return info
    raise UnknownSource(
        f"source {requested!r} is unavailable; valid sources: "
        + ", ".join(info.id for info in available)
    )


__all__ = [
    "LOCAL_ID",
    "MANIFEST_NAME",
    "MANIFEST_VERSION",
    "RELEASE_PREFIX",
    "RELEASE_TAG_RE",
    "SNAPSHOT_DB_NAME",
    "SourceInfo",
    "is_release_tag",
    "UnknownSource",
    "discover",
    "local_source",
    "releases_root",
    "resolve",
]

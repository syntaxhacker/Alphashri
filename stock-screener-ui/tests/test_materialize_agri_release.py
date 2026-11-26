"""Cumulative release materialization from local fixture assets (no network)."""

from __future__ import annotations

import gzip
import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Any

import pytest

from api.agri import sources, store
from scripts import materialize_agri_release as materializer
from scripts import sync_refresh_assets as sync

pytestmark = pytest.mark.unit

TAG = "data-2026-11"
DAY_1 = "2025-10-27"
DAY_2 = "2026-11-21"


def _row(day: str, market: str, modal: float = 100.0) -> dict[str, Any]:
    return {
        "date": day, "state": "Maharashtra", "district": "Pune", "market": market,
        "commodity": "Onion", "commodity_key": "onion", "variety": "No 1", "grade": "FAQ",
        "min_price": modal - 10.0, "max_price": modal + 10.0, "modal_price": modal,
        "arrivals_qtl": None, "price_unit": "INR/quintal", "source": "agmarknet_daily",
    }


def _write_asset(root: Path, day: str, rows: list[dict[str, Any]]) -> tuple[Path, Path]:
    raw = ("\n".join(json.dumps(row) for row in rows) + "\n").encode("utf-8")
    compressed = gzip.compress(raw, mtime=0)
    asset = root / "agri" / f"{day}.jsonl.gz"
    asset.parent.mkdir(parents=True, exist_ok=True)
    asset.write_bytes(compressed)
    manifest = {
        "kind": "agri", "as_of": day, "date": day, "rows": len(rows),
        "commodities": len({row["commodity_key"] for row in rows}),
        "source": "data.gov.in/test", "arrivals_present": False,
        "sha256": hashlib.sha256(compressed).hexdigest(),
        "created_at": "2026-11-21T20:30:00+05:30", "status": "complete",
    }
    manifest_path = root / "manifests" / f"agri-{day}.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    return asset, manifest_path


@pytest.fixture
def assets(tmp_path: Path) -> list[tuple[Path, Path]]:
    root = tmp_path / "assets"
    return [
        _write_asset(root, DAY_1, [_row(DAY_1, "Pune APMC")]),
        _write_asset(root, DAY_2, [
            _row(DAY_2, "Pune APMC", 200.0), _row(DAY_2, "Nashik APMC", 210.0),
        ]),
    ]


def _read_db(path: Path) -> list[tuple[str, str, float]]:
    conn = sqlite3.connect(path)
    try:
        return [
            (row[0], row[1], float(row[2]))
            for row in conn.execute(
                f"SELECT date, market, modal_price FROM {store.TABLE} ORDER BY date, market"
            )
        ]
    finally:
        conn.close()


def test_materialize_from_assets_is_cumulative(assets: list[tuple[Path, Path]], tmp_path: Path):
    out_db = tmp_path / "snapshot" / sources.SNAPSHOT_DB_NAME
    out_db.parent.mkdir()
    stats = materializer.materialize_from_assets(assets, out_db)

    assert stats.as_of == DAY_2
    assert stats.dates == [DAY_1, DAY_2]
    assert stats.rows == 3
    assert stats.quarantined == 0
    assert _read_db(out_db) == [
        (DAY_1, "Pune APMC", 100.0),
        (DAY_2, "Nashik APMC", 210.0),
        (DAY_2, "Pune APMC", 200.0),
    ]
    conn = sqlite3.connect(out_db)
    try:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0].lower() == "delete"
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert store.TABLE in tables
    finally:
        conn.close()
    assert not (tmp_path / "snapshot" / f"{sources.SNAPSHOT_DB_NAME}-wal").exists()


def test_selection_is_cumulative_across_monthly_tags(monkeypatch: pytest.MonkeyPatch):
    def asset(release: str, name: str) -> sync.ReleaseAsset:
        return sync.ReleaseAsset(release=release, name=name, url="https://example.invalid/x")

    remote = [
        asset("data-2025-10", f"agri/{DAY_1}.jsonl.gz"),
        asset("data-2025-10", f"manifests/agri-{DAY_1}.json"),
        asset(TAG, f"agri/{DAY_2}.jsonl.gz"),
        asset(TAG, f"manifests/agri-{DAY_2}.json"),
        asset(TAG, f"52w/{DAY_2}.json.gz"),
        asset(TAG, f"manifests/52w-{DAY_2}.json"),
    ]
    monkeypatch.setattr(sync, "list_github_assets", lambda **_: remote)
    pairs = materializer._select_pairs(
        TAG, DAY_1, assets_dir=None, repo="unused/repo", token=None
    )
    assert [pair.as_of for pair in pairs] == [DAY_1, DAY_2]
    assert all(pair.kind == "agri" for pair in pairs)


def test_materialize_from_assets_rejects_bad_checksum(
    assets: list[tuple[Path, Path]], tmp_path: Path
):
    asset, manifest = assets[0]
    asset.write_bytes(asset.read_bytes() + b"corrupt")
    with pytest.raises(sync.ChecksumMismatch, match="checksum"):
        materializer.materialize_from_assets(
            [(asset, manifest)], tmp_path / "snapshot.db"
        )


def test_run_materialize_writes_only_out_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    assets_dir = tmp_path / "assets"
    for day, rows in (
        (DAY_1, [_row(DAY_1, "Pune APMC")]),
        (DAY_2, [_row(DAY_2, "Pune APMC", 200.0)]),
    ):
        _write_asset(assets_dir, day, rows)
    releases = tmp_path / "releases"
    releases.mkdir()
    out = releases / TAG
    main_cache = tmp_path / "main-cache.db"
    main_cache.write_bytes(b"untouched")
    monkeypatch.setattr(store, "DEFAULT_DB_PATH", main_cache)

    stats = materializer.run_materialize(
        tag=TAG, out=out, from_date=DAY_1, assets_dir=assets_dir,
        cache_dir=tmp_path / "cache", repo="unused/repo",
    )
    assert stats.rows == 2
    assert stats.dates == [DAY_1, DAY_2]
    assert sorted(path.name for path in out.iterdir()) == sorted([
        sources.MANIFEST_NAME, sources.SNAPSHOT_DB_NAME,
    ])
    manifest = json.loads((out / sources.MANIFEST_NAME).read_text())
    assert manifest == {
        "version": 1, "tag": TAG, "status": "ready", "as_of": DAY_2,
        "rows": 2, "dates": [DAY_1, DAY_2], "cumulative": True,
        "built_at": manifest["built_at"],
        "source_range": {"from": DAY_1, "to": DAY_2},
    }
    assert manifest["built_at"]
    assert main_cache.read_bytes() == b"untouched"
    assert not (tmp_path / "refresh_runs.json").exists()
    assert not list(releases.glob(".agri-materialize-*"))
    # The manifest is valid for the API source scanner.
    listed = sources.discover(releases)
    assert [item.id for item in listed] == ["local", f"release:{TAG}"]
    assert sources.resolve(f"release:{TAG}", root=releases).rows == 2


def test_force_and_dry_run(tmp_path: Path, assets: list[tuple[Path, Path]]):
    assets_dir = tmp_path / "assets"
    for asset, manifest in assets:
        for source in (asset, manifest):
            target = assets_dir / source.relative_to(source.parents[1])
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.read_bytes())

    out = tmp_path / "release"
    dry = materializer.run_materialize(
        tag=TAG, out=out, from_date=DAY_1, assets_dir=assets_dir,
        cache_dir=tmp_path / "cache", dry_run=True,
    )
    assert dry.rows == 3
    assert not out.exists()
    assert not list(tmp_path.glob(".agri-materialize-*"))
    assert not (tmp_path / "cache").exists()

    materializer.run_materialize(
        tag=TAG, out=out, from_date=DAY_1, assets_dir=assets_dir,
        cache_dir=tmp_path / "cache",
    )
    before = (out / sources.MANIFEST_NAME).read_bytes()
    with pytest.raises(materializer.MaterializeError, match="--force"):
        materializer.run_materialize(
            tag=TAG, out=out, from_date=DAY_1, assets_dir=assets_dir,
            cache_dir=tmp_path / "cache",
        )
    assert (out / sources.MANIFEST_NAME).read_bytes() == before
    materializer.run_materialize(
        tag=TAG, out=out, from_date=DAY_1, assets_dir=assets_dir,
        cache_dir=tmp_path / "cache", force=True,
    )
    assert (out / sources.SNAPSHOT_DB_NAME).exists()
    assert not list(tmp_path.glob(".*old-*"))


def test_cli_dry_run_writes_nothing(tmp_path: Path, assets: list[tuple[Path, Path]]):
    assets_dir = tmp_path / "assets"
    for asset, manifest in assets:
        for source in (asset, manifest):
            target = assets_dir / source.relative_to(source.parents[1])
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.read_bytes())
    out = tmp_path / "release"
    code = materializer.main([
        "--release-tag", TAG, "--out", str(out), "--from", DAY_1,
        "--assets-dir", str(assets_dir), "--dry-run",
    ])
    assert code == 0
    assert not out.exists()

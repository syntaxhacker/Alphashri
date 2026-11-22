"""Release-sync validation and local-apply tests (no network, no GitHub Actions)."""

from __future__ import annotations

import gzip
import hashlib
import json
import sqlite3
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.agri import store
from db.models.stock_52w_touch import Stock52WeekRange
from scripts import sync_refresh_assets as sync

pytestmark = pytest.mark.unit

AS_OF = "2026-11-21"
SECOND_AS_OF = "2026-11-20"


def _agri_row(index: int = 0, **overrides):
    row = {
        "date": AS_OF,
        "state": "Maharashtra",
        "district": "Pune",
        "market": f"Market {index}",
        "commodity": "Onion",
        "commodity_key": "onion",
        "variety": "Other",
        "grade": "FAQ",
        "min_price": 1000.0 + index,
        "max_price": 1400.0 + index,
        "modal_price": 1200.0 + index,
        "arrivals_qtl": None,
        "price_unit": "INR/quintal",
        "source": "agmarknet_daily",
    }
    row.update(overrides)
    return row


def _write_manifest(
    root: Path, kind: str, as_of: str, manifest: dict, *, flat: bool = False
) -> Path:
    rel = Path(f"{kind}-{as_of}.json") if flat else Path("manifests") / f"{kind}-{as_of}.json"
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest), encoding="utf-8")
    return path


def write_agri_fixture(
    root: Path,
    *,
    as_of: str = AS_OF,
    rows: list[dict] | None = None,
    write_payload: bool = True,
    write_manifest: bool = True,
    rows_override: int | None = None,
    arrivals_override: bool | None = None,
    flat: bool = False,
) -> tuple[Path, Path]:
    rows = rows if rows is not None else [_agri_row(0), _agri_row(1)]
    raw = ("\n".join(json.dumps(row) for row in rows) + "\n").encode("utf-8")
    compressed = gzip.compress(raw, mtime=0)
    asset_rel = Path(f"{as_of}.jsonl.gz") if flat else Path("agri") / f"{as_of}.jsonl.gz"
    asset = root / asset_rel
    asset.parent.mkdir(parents=True, exist_ok=True)
    if write_payload:
        asset.write_bytes(compressed)

    manifest = {
        "kind": "agri",
        "as_of": as_of,
        "date": as_of,
        "rows": len(rows) if rows_override is None else rows_override,
        "commodities": len({row["commodity_key"] for row in rows}),
        "source": "data.gov.in/test",
        "arrivals_present": (
            any(row.get("arrivals_qtl") is not None for row in rows)
            if arrivals_override is None
            else arrivals_override
        ),
        "sha256": hashlib.sha256(compressed).hexdigest(),
        "created_at": "2026-11-21T20:30:00+05:30",
    }
    manifest_rel = Path(f"agri-{as_of}.json") if flat else Path("manifests") / f"agri-{as_of}.json"
    manifest_path = (
        _write_manifest(root, "agri", as_of, manifest, flat=flat)
        if write_manifest
        else root / manifest_rel
    )
    return asset, manifest_path


def write_52w_fixture(
    root: Path,
    *,
    as_of: str = AS_OF,
    symbols: dict | None = None,
    write_payload: bool = True,
    flat: bool = False,
) -> tuple[Path, Path]:
    symbols = symbols if symbols is not None else {
        "AAA": {"high": 110.0, "low": 80.0, "close": 100.0, "days_ago": 3},
        "BBB": {"high": 210.0, "low": 180.0, "close": 200.0, "days_ago": None},
    }
    payload = {"as_of": as_of, "count": len(symbols), "symbols": symbols}
    compressed = gzip.compress(json.dumps(payload).encode("utf-8"), mtime=0)
    asset_rel = Path(f"{as_of}.json.gz") if flat else Path("52w") / f"{as_of}.json.gz"
    asset = root / asset_rel
    asset.parent.mkdir(parents=True, exist_ok=True)
    if write_payload:
        asset.write_bytes(compressed)
    manifest = {
        "kind": "52w",
        "as_of": as_of,
        "date": as_of,
        "rows": len(symbols),
        "sha256": hashlib.sha256(compressed).hexdigest(),
        "created_at": "2026-11-21T20:30:00+05:30",
    }
    manifest_path = _write_manifest(root, "52w", as_of, manifest, flat=flat)
    return asset, manifest_path


def _validated(root: Path):
    assets = sync.list_local_assets(root)
    pairs = sync.build_pairs(assets)
    pair = next(item for item in pairs if item.kind == "agri")
    path = sync.materialize(pair.asset, root / "cache")
    return sync.validate_asset(pair, path)


class TestManifestValidation:
    def test_valid_manifest_hash_and_row_count(self, tmp_path):
        write_agri_fixture(tmp_path)
        write_52w_fixture(tmp_path)

        assets = sync.list_local_assets(tmp_path)
        pairs = sync.build_pairs(assets)
        assert {(pair.kind, pair.as_of) for pair in pairs} == {
            ("agri", AS_OF),
            ("52w", AS_OF),
        }

        validated = _validated(tmp_path)
        assert validated.kind == "agri"
        assert validated.as_of == AS_OF
        assert len(validated.payload) == 2
        assert validated.manifest["arrivals_present"] is False

    def test_checksum_mismatch_is_rejected(self, tmp_path):
        asset, _ = write_agri_fixture(tmp_path)
        asset.write_bytes(asset.read_bytes() + b"corrupt")
        with pytest.raises(sync.ChecksumMismatch, match="checksum"):
            _validated(tmp_path)

    def test_row_count_mismatch_is_rejected(self, tmp_path):
        write_agri_fixture(tmp_path, rows_override=99)
        with pytest.raises(sync.ManifestError, match="rows"):
            _validated(tmp_path)

    def test_missing_asset_is_rejected(self, tmp_path):
        write_agri_fixture(tmp_path, write_payload=False)
        with pytest.raises(sync.MissingAsset, match="missing"):
            sync.build_pairs(sync.list_local_assets(tmp_path))

    def test_missing_manifest_is_rejected(self, tmp_path):
        write_agri_fixture(tmp_path, write_manifest=False)
        with pytest.raises(sync.MissingAsset, match="manifest"):
            sync.build_pairs(sync.list_local_assets(tmp_path))

    def test_arrivals_flag_must_match_payload(self, tmp_path):
        write_agri_fixture(tmp_path, arrivals_override=True)
        with pytest.raises(sync.ManifestError, match="arrivals_present"):
            _validated(tmp_path)

    def test_non_finite_52w_value_is_rejected(self, tmp_path):
        write_52w_fixture(
            tmp_path,
            symbols={"AAA": {"high": 110.0, "low": 80.0, "close": float("nan")}},
        )
        pair = next(item for item in sync.build_pairs(sync.list_local_assets(tmp_path)) if item.kind == "52w")
        path = sync.materialize(pair.asset, tmp_path / "cache")
        with pytest.raises(sync.ManifestError, match="non-finite"):
            sync.validate_asset(pair, path)

    def test_empty_52w_asset_is_rejected(self, tmp_path):
        write_52w_fixture(tmp_path, symbols={})
        pair = next(item for item in sync.build_pairs(sync.list_local_assets(tmp_path)) if item.kind == "52w")
        path = sync.materialize(pair.asset, tmp_path / "cache")
        with pytest.raises(sync.ManifestError, match="0 symbols"):
            sync.validate_asset(pair, path)


class TestRemoteAssetFreshness:
    def test_remote_manifest_is_refreshed_before_checksum(self, tmp_path, monkeypatch):
        write_52w_fixture(tmp_path / "assets")
        local = next(
            item
            for item in sync.build_pairs(sync.list_local_assets(tmp_path / "assets"))
            if item.kind == "52w"
        )
        remote = sync.AssetPair(
            kind=local.kind,
            as_of=local.as_of,
            release=local.release,
            asset=sync.ReleaseAsset(
                release=local.release, name=local.asset.name, url="https://example.invalid/asset"
            ),
            manifest=sync.ReleaseAsset(
                release=local.release,
                name=local.manifest.name,
                url="https://example.invalid/manifest",
            ),
        )
        calls: list[tuple[str, bool]] = []

        def fake_materialize(asset, cache_dir, token=None, force=False):
            calls.append((asset.name, force))
            return local.manifest.local_path if asset.name.endswith(".json") else local.asset.local_path

        monkeypatch.setattr(sync, "materialize", fake_materialize)
        validated = sync._download_and_validate(remote, tmp_path / "cache", None)

        assert validated.kind == "52w"
        manifest_forces = [force for name, force in calls if name.endswith(".json")]
        asset_forces = [force for name, force in calls if not name.endswith(".json")]
        assert manifest_forces == [True], calls
        assert asset_forces == [False], calls


class TestDryRun:
    def test_dry_run_verifies_but_writes_nothing(self, tmp_path):
        assets = tmp_path / "assets"
        write_agri_fixture(assets)
        write_52w_fixture(assets)
        agri_db = tmp_path / "agri.db"
        state = tmp_path / "refresh_runs.json"

        summary = sync.run_sync(
            mode="range",
            from_date=AS_OF,
            to_date=AS_OF,
            assets_dir=assets,
            cache_dir=tmp_path / "cache",
            agri_db_path=agri_db,
            state_file=state,
            dry_run=True,
            use_redis=False,
        )

        assert summary.dry_run is True
        assert summary.agri_rows_verified == 2
        assert summary.agri_rows_applied == 0
        assert summary.week52_symbols_verified == 2
        assert not agri_db.exists()
        assert not state.exists()


class TestApplyIsIdempotent:
    def test_agri_upsert_replay_keeps_row_count(self):
        conn = sqlite3.connect(":memory:")
        try:
            store.ensure_schema(conn)
            rows, quarantined = sync.prepare_agri_rows([_agri_row(0), _agri_row(1)])
            assert quarantined == 0
            assert sync.apply_agri_rows(conn, rows) == 2
            assert sync.apply_agri_rows(conn, rows) == 2
            count = conn.execute(f"SELECT COUNT(*) FROM {store.TABLE}").fetchone()[0]
            assert count == 2
            assert sync.agri_max_date(conn) == AS_OF
        finally:
            conn.close()

    def test_52w_change_only_replay_writes_nothing(self, tmp_path):
        engine = create_engine(
            f"sqlite:///{tmp_path / 'app.db'}",
            connect_args={"check_same_thread": False},
        )
        Stock52WeekRange.__table__.create(bind=engine)
        Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        data = {
            "symbols": {
                "AAA": {"high": 110.0, "low": 80.0, "close": 100.0, "days_ago": 3},
                "BBB": {"high": 210.0, "low": 180.0, "close": 200.0, "days_ago": None},
            }
        }
        try:
            assert sync.apply_52w_data(Session, data) == (2, 0)
            first = sync.count_52w(Session)
            assert sync.apply_52w_data(Session, data) == (0, 0)
            assert sync.count_52w(Session) == first == 2
            assert sync.apply_52w_data(Session, {"symbols": data["symbols"]}) == (0, 0)
        finally:
            engine.dispose()

    def test_full_sync_replay_does_not_duplicate(self, tmp_path):
        assets = tmp_path / "assets"
        write_agri_fixture(assets)
        write_52w_fixture(assets)

        engine = create_engine(
            f"sqlite:///{tmp_path / 'app.db'}",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Stock52WeekRange.__table__.create(bind=engine)
        Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        kwargs = dict(
            mode="range",
            from_date=AS_OF,
            to_date=AS_OF,
            assets_dir=assets,
            cache_dir=tmp_path / "cache",
            agri_db_path=tmp_path / "agri.db",
            session_factory=Session,
            state_file=tmp_path / "state.json",
            use_redis=False,
        )
        try:
            first = sync.run_sync(**kwargs)
            second = sync.run_sync(**kwargs)
            assert first.agri_rows_applied == 2
            assert first.week52_added == 2
            assert second.week52_added == 0
            assert second.week52_updated == 0
            assert second.week52_total == 2

            conn = sqlite3.connect(tmp_path / "agri.db")
            try:
                count = conn.execute(f"SELECT COUNT(*) FROM {store.TABLE}").fetchone()[0]
            finally:
                conn.close()
            assert count == 2

            runs = json.loads((tmp_path / "state.json").read_text())
            assert len(runs) == 2
            assert runs[-1]["status"] == "ok"
        finally:
            engine.dispose()


class TestFlatReleaseNames:
    """Release assets are flat; packaged trees use directory prefixes."""

    @pytest.mark.parametrize(
        "name",
        [
            f"agri/{AS_OF}.jsonl.gz",
            f"{AS_OF}.jsonl.gz",
            f"52w/{AS_OF}.json.gz",
            f"{AS_OF}.json.gz",
            f"manifests/agri-{AS_OF}.json",
            f"agri-{AS_OF}.json",
            f"manifests/52w-{AS_OF}.json",
            f"52w-{AS_OF}.json",
        ],
    )
    def test_matching_accepts_prefixed_and_flat(self, name):
        assert sync.asset_date(name) == AS_OF
        assert sync.is_refresh_asset(name)

    def test_unrelated_files_are_ignored(self):
        assert sync.asset_date("releases.tsv") is None
        assert not sync.is_refresh_asset("releases.tsv")
        assert not sync.is_refresh_asset(f"agri/{AS_OF}.json")

    def test_canonical_names_stay_prefixed(self):
        assert sync.asset_name("agri", AS_OF) == f"agri/{AS_OF}.jsonl.gz"
        assert sync.asset_name("52w", AS_OF) == f"52w/{AS_OF}.json.gz"
        assert sync.manifest_name("agri", AS_OF) == f"manifests/agri-{AS_OF}.json"
        assert sync.manifest_name("52w", AS_OF) == f"manifests/52w-{AS_OF}.json"

    def test_github_listing_keeps_flat_assets(self, monkeypatch):
        payload = [{
            "tag_name": "data-2026-11",
            "draft": False,
            "assets": [
                {"name": f"{AS_OF}.jsonl.gz", "browser_download_url": "u1", "size": 1},
                {"name": f"agri-{AS_OF}.json", "browser_download_url": "u2", "size": 2},
                {"name": f"{AS_OF}.json.gz", "browser_download_url": "u3", "size": 3},
                {"name": f"52w-{AS_OF}.json", "browser_download_url": "u4", "size": 4},
                {"name": "releases.tsv", "browser_download_url": "u5", "size": 5},
            ],
        }]
        monkeypatch.setattr(sync, "_github_request", lambda url, token: payload)

        assets = sync.list_github_assets()

        assert {asset.name for asset in assets} == {
            f"{AS_OF}.jsonl.gz",
            f"agri-{AS_OF}.json",
            f"{AS_OF}.json.gz",
            f"52w-{AS_OF}.json",
        }
        assert {(pair.kind, pair.as_of) for pair in sync.build_pairs(assets)} == {
            ("agri", AS_OF),
            ("52w", AS_OF),
        }

    def test_flat_assets_dir_pairs_and_validates(self, tmp_path):
        write_agri_fixture(tmp_path, flat=True)
        write_52w_fixture(tmp_path, flat=True)

        assets = sync.list_local_assets(tmp_path)
        assert {asset.name for asset in assets} == {
            f"{AS_OF}.jsonl.gz",
            f"agri-{AS_OF}.json",
            f"{AS_OF}.json.gz",
            f"52w-{AS_OF}.json",
        }
        pairs = sync.build_pairs(assets)
        assert {(pair.kind, pair.as_of) for pair in pairs} == {
            ("agri", AS_OF),
            ("52w", AS_OF),
        }
        for pair in pairs:
            validated = sync.validate_asset(pair, sync.materialize(pair.asset, tmp_path / "cache"))
            assert validated.as_of == AS_OF

    def test_flat_assets_dir_runs_in_range_mode(self, tmp_path):
        assets = tmp_path / "assets"
        write_agri_fixture(assets, flat=True)
        write_52w_fixture(assets, flat=True)

        summary = sync.run_sync(
            mode="range",
            from_date=AS_OF,
            to_date=AS_OF,
            assets_dir=assets,
            cache_dir=tmp_path / "cache",
            agri_db_path=tmp_path / "missing.db",
            state_file=tmp_path / "state.json",
            dry_run=True,
            use_redis=False,
        )

        assert summary.agri_dates == [AS_OF]
        assert summary.week52_dates == [AS_OF]
        assert summary.agri_rows_verified == 2
        assert summary.week52_symbols_verified == 2

    def test_mixed_prefixed_and_flat_pairs(self, tmp_path):
        write_agri_fixture(tmp_path)
        write_52w_fixture(tmp_path, flat=True)
        write_agri_fixture(
            tmp_path,
            as_of=SECOND_AS_OF,
            flat=True,
            rows=[_agri_row(0, date=SECOND_AS_OF), _agri_row(1, date=SECOND_AS_OF)],
        )
        write_52w_fixture(tmp_path, as_of=SECOND_AS_OF)

        assets = sync.list_local_assets(tmp_path)
        assert len(assets) == 8
        pairs = sync.build_pairs(assets)
        assert {(pair.kind, pair.as_of) for pair in pairs} == {
            ("agri", AS_OF),
            ("agri", SECOND_AS_OF),
            ("52w", AS_OF),
            ("52w", SECOND_AS_OF),
        }
        for pair in pairs:
            sync.validate_asset(pair, sync.materialize(pair.asset, tmp_path / "cache"))

    def test_flat_missing_asset_is_rejected(self, tmp_path):
        write_agri_fixture(tmp_path, flat=True, write_payload=False)
        with pytest.raises(sync.MissingAsset, match="missing"):
            sync.build_pairs(sync.list_local_assets(tmp_path))

    def test_flat_missing_manifest_is_rejected(self, tmp_path):
        write_agri_fixture(tmp_path, flat=True, write_manifest=False)
        with pytest.raises(sync.MissingAsset, match="manifest"):
            sync.build_pairs(sync.list_local_assets(tmp_path))

    def test_mixed_orphan_asset_is_rejected(self, tmp_path):
        write_agri_fixture(tmp_path, flat=True)
        _, manifest = write_52w_fixture(tmp_path, as_of=SECOND_AS_OF, flat=True)
        manifest.unlink()
        with pytest.raises(sync.MissingAsset, match="manifest"):
            sync.build_pairs(sync.list_local_assets(tmp_path))

    def test_duplicate_names_do_not_create_extra_pairs(self, tmp_path):
        write_agri_fixture(tmp_path, flat=True)
        assets = sync.list_local_assets(tmp_path)
        pairs = sync.build_pairs(list(assets) + list(assets))
        assert [(pair.kind, pair.as_of) for pair in pairs] == [("agri", AS_OF)]

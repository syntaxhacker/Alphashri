"""Offline packaging tests: complete partitions -> release-shaped assets.

No real cache, no network, no release/upload. All fixtures are temp SQLite DBs.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.agri import registry, store  # noqa: E402
from scripts.market import package_agri_db as pkg  # noqa: E402

pytestmark = pytest.mark.unit

CREATED_AT = "2026-11-22T12:30:49+05:30"


def _row(day: str, *, market: str, key: str = "onion", arrivals: float | None = None,
         source: str = pkg.SOURCE) -> dict[str, Any]:
    return {
        "date": day,
        "state": "Maharashtra",
        "district": "Pune",
        "market": market,
        "commodity": registry.label_for(key),
        "commodity_key": key,
        "variety": "Other",
        "grade": "FAQ",
        "min_price": 1000.0,
        "max_price": 1400.0,
        "modal_price": 1200.0,
        "arrivals_qtl": arrivals,
        "price_unit": registry.PRICE_UNIT,
        "source": source,
        "source_commodity": registry.label_for(key),
        "product_form": "",
        "arrival_units": "",
        "price_source": source,
        "arrivals_source": "none" if arrivals is None else "daily",
        "ingested_at": CREATED_AT,
    }


def _partition(day: str, status: str = "complete", *, error: str | None = None) -> dict[str, Any]:
    return {
        "source": pkg.SOURCE,
        "date": day,
        "status": status,
        "error": error,
        "expected_total": 2,
        "fetched_rows": 2,
    }


def _make_db(path: Path, rows: list[dict[str, Any]], partitions: list[dict[str, Any]]) -> Path:
    conn = store.open_writer(path)
    try:
        store.upsert_rows(conn, rows)
        for item in partitions:
            store.upsert_partition(
                conn,
                source=item["source"],
                arrival_date=item["date"],
                status=item["status"],
                expected_total=item.get("expected_total"),
                fetched_rows=item.get("fetched_rows"),
                error=item.get("error"),
            )
    finally:
        conn.close()
    return path


def _asset_lines(build_dir: Path, day: str) -> list[dict[str, Any]]:
    raw = gzip.decompress((build_dir / "agri" / f"{day}.jsonl.gz").read_bytes())
    return [json.loads(line) for line in raw.decode("utf-8").splitlines() if line.strip()]


class TestRowSelection:
    def test_only_complete_daily_partition_rows_are_exported(self, tmp_path):
        day_a, day_b, partial_day = "2026-11-20", "2026-11-21", "2026-11-19"
        db = _make_db(
            tmp_path / "agri.db",
            rows=[
                _row(day_a, market="A-1"),
                _row(day_a, market="A-2", key="wheat"),
                # Same date, different source: must never enter an asset.
                _row(day_a, market="CKAN-1", source="agmarknet_ckan"),
                _row(day_b, market="B-1"),
                _row(partial_day, market="P-1"),
            ],
            partitions=[
                _partition(day_a),
                _partition(day_b),
                _partition(partial_day, "partial", error="rows_seen 1 != api total 2"),
            ],
        )
        build_dir = tmp_path / "build"

        result = pkg.package_from_db(
            db, build_dir,
            from_date=partial_day, to_date=day_b, created_at=CREATED_AT,
        )

        assert result.packaged_dates == [day_a, day_b]
        assert [item.date for item in result.skipped] == [partial_day]
        assert result.rows == 3  # 2 + 1 daily rows; CKAN and partial excluded

        rows_a = _asset_lines(build_dir, day_a)
        assert len(rows_a) == 2
        assert {row["market"] for row in rows_a} == {"A-1", "A-2"}
        assert all(row["source"] == pkg.SOURCE for row in rows_a)
        assert len(_asset_lines(build_dir, day_b)) == 1
        assert not (build_dir / "agri" / f"{partial_day}.jsonl.gz").exists()

    def test_payload_columns_and_gzip_match_workflow(self, tmp_path):
        day = "2026-11-21"
        db = _make_db(tmp_path / "agri.db", [_row(day, market="M-1")], [_partition(day)])
        build_dir = tmp_path / "build"

        pkg.package_from_db(db, build_dir, created_at=CREATED_AT)

        compressed = (build_dir / "agri" / f"{day}.jsonl.gz").read_bytes()
        # gzip.compress(..., mtime=0) writes four zero bytes at offset 4.
        assert compressed[4:8] == b"\x00\x00\x00\x00"
        raw = gzip.decompress(compressed).decode("utf-8")
        assert raw.endswith("\n")
        line = raw.splitlines()[0]
        assert list(json.loads(line).keys()) == sorted(json.loads(line).keys())
        assert set(json.loads(line)) == set(store.COLUMNS)
        assert raw == (
            json.dumps(_row(day, market="M-1"), sort_keys=True, separators=(",", ":")) + "\n"
        )


class TestManifestHashes:
    def test_manifest_fields_and_sha256_of_compressed_bytes(self, tmp_path):
        day = "2026-11-21"
        rows = [
            _row(day, market="M-1", key="onion", arrivals=120.0),
            _row(day, market="M-2", key="wheat"),
        ]
        db = _make_db(tmp_path / "agri.db", rows, [_partition(day)])
        build_dir = tmp_path / "build"

        result = pkg.package_from_db(db, build_dir, created_at=CREATED_AT)

        manifest = json.loads((build_dir / "manifests" / f"agri-{day}.json").read_text())
        asset_bytes = (build_dir / "agri" / f"{day}.jsonl.gz").read_bytes()
        assert set(manifest) == {
            "kind", "as_of", "date", "rows", "commodities", "source",
            "arrivals_present", "sha256", "created_at", "status",
            "quarantined", "duplicates",
        }
        assert manifest["kind"] == "agri"
        assert manifest["as_of"] == manifest["date"] == day
        assert manifest["status"] == "complete"
        assert manifest["rows"] == 2
        assert manifest["commodities"] == 2
        assert manifest["source"] == f"data.gov.in/{registry.DATA_GOV_IN_RESOURCE_ID}"
        assert manifest["sha256"] == hashlib.sha256(asset_bytes).hexdigest()
        assert manifest["created_at"] == CREATED_AT
        assert manifest["quarantined"] == 0
        assert manifest["duplicates"] == 0
        assert manifest["arrivals_present"] is True

        validated = pkg.validate_generated(day, build_dir)
        assert validated.kind == "agri"
        assert validated.as_of == day
        assert len(validated.payload) == manifest["rows"]
        assert result.validated == 1

    def test_arrivals_present_false_for_arrival_less_day(self, tmp_path):
        day = "2026-11-20"
        db = _make_db(tmp_path / "agri.db", [_row(day, market="M-1")], [_partition(day)])
        build_dir = tmp_path / "build"

        pkg.package_from_db(db, build_dir, created_at=CREATED_AT)

        manifest = json.loads((build_dir / "manifests" / f"agri-{day}.json").read_text())
        assert manifest["arrivals_present"] is False

    def test_corrupt_asset_fails_sync_validation(self, tmp_path):
        day = "2026-11-21"
        db = _make_db(tmp_path / "agri.db", [_row(day, market="M-1")], [_partition(day)])
        build_dir = tmp_path / "build"
        pkg.package_from_db(db, build_dir, created_at=CREATED_AT)

        asset = build_dir / "agri" / f"{day}.jsonl.gz"
        asset.write_bytes(asset.read_bytes() + b"corrupt")
        with pytest.raises(Exception, match="checksum"):
            pkg.validate_generated(day, build_dir)


class TestPartialExclusion:
    def test_partial_and_failed_dates_are_listed_not_published(self, tmp_path):
        complete = "2026-11-21"
        partial = "2026-11-08"
        failed = "2026-11-01"
        db = _make_db(
            tmp_path / "agri.db",
            rows=[
                _row(complete, market="C-1"),
                _row(partial, market="P-1"),
                _row(failed, market="F-1"),
            ],
            partitions=[
                _partition(complete),
                _partition(partial, "partial", error="missing tracked keys: turmeric, jeera"),
                _partition(failed, "failed", error="data.gov.in returned HTTP 429"),
            ],
        )
        build_dir = tmp_path / "build"

        result = pkg.package_from_db(db, build_dir, created_at=CREATED_AT)

        assert result.packaged_dates == [complete]
        by_date = {item.date: item for item in result.skipped}
        assert set(by_date) == {partial, failed}
        assert by_date[partial].status == "partial"
        assert "turmeric" in by_date[partial].reason
        assert by_date[failed].status == "failed"
        assert "429" in by_date[failed].reason
        for day in (partial, failed):
            assert not (build_dir / "agri" / f"{day}.jsonl.gz").exists()
            assert not (build_dir / "manifests" / f"agri-{day}.json").exists()
        assert all(item.status != "complete" for item in result.skipped)


class TestEmptyOutput:
    def test_no_complete_partitions_produces_no_assets(self, tmp_path):
        day = "2026-11-08"
        db = _make_db(
            tmp_path / "agri.db",
            rows=[_row(day, market="P-1")],
            partitions=[_partition(day, "partial", error="rows_seen 1 != api total 2")],
        )
        build_dir = tmp_path / "build"

        result = pkg.package_from_db(db, build_dir, created_at=CREATED_AT)

        assert result.packaged_dates == []
        assert result.asset_paths == []
        assert result.validated == 0
        assert result.total_bytes == 0
        assert [item.date for item in result.skipped] == [day]
        assert not list((build_dir / "agri").glob("*"))
        assert not list((build_dir / "manifests").glob("*"))
        assert (build_dir / "releases.tsv").read_text() == ""
        assert result.release_groups == {}


class TestReleaseGroups:
    def test_monthly_grouping_of_asset_and_manifest_paths(self, tmp_path):
        oct_day, nov_day_1, nov_day_2 = "2026-10-31", "2026-11-01", "2026-11-21"
        db = _make_db(
            tmp_path / "agri.db",
            rows=[
                _row(oct_day, market="O-1"),
                _row(nov_day_1, market="N-1"),
                _row(nov_day_2, market="N-2"),
            ],
            partitions=[_partition(day) for day in (oct_day, nov_day_1, nov_day_2)],
        )
        build_dir = tmp_path / "build"

        result = pkg.package_from_db(db, build_dir, created_at=CREATED_AT)

        assert list(result.release_groups) == ["data-2026-10", "data-2026-11"]
        oct_paths = result.release_groups["data-2026-10"]
        assert len(oct_paths) == 2
        assert any(path.endswith("agri/2026-10-31.jsonl.gz") for path in oct_paths)
        assert any(path.endswith("manifests/agri-2026-10-31.json") for path in oct_paths)
        assert len(result.release_groups["data-2026-11"]) == 4

        lines = (build_dir / "releases.tsv").read_text().splitlines()
        assert lines == [
            f"{tag}\t{' '.join(paths)}"
            for tag, paths in result.release_groups.items()
        ]

"""Source discovery and the read-only release-snapshot HTTP path."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.agri import sources, store
from api.agri.router import router as agri_router

TAG = "data-2026-11"
TODAY = "2026-11-20"


def _row(day: str = TODAY, *, key: str = "onion", modal: float = 100.0) -> dict[str, Any]:
    return {
        "date": day, "state": "Maharashtra", "district": "Pune", "market": "Pune APMC",
        "commodity": key.title(), "commodity_key": key, "variety": "No 1", "grade": "FAQ",
        "min_price": modal - 10.0, "max_price": modal + 10.0, "modal_price": modal,
        "arrivals_qtl": 10.0, "price_unit": "Rs./Quintal", "source": "agmarknet_daily",
    }


def _make_db(path: Path, rows: list[dict[str, Any]]) -> None:
    conn = store.open_writer(path)
    try:
        conn.execute("PRAGMA journal_mode=DELETE")
        store.upsert_rows(conn, rows)
    finally:
        conn.close()


def _manifest(**overrides: Any) -> dict[str, Any]:
    value: dict[str, Any] = {
        "version": 1, "tag": TAG, "status": "ready", "as_of": TODAY,
        "rows": 1, "dates": [TODAY], "cumulative": True,
        "built_at": "2026-11-21T20:30:00+05:30",
        "source_range": {"from": "2025-10-27", "to": TODAY},
    }
    value.update(overrides)
    return value


def _snapshot(root: Path, *, manifest: dict[str, Any] | None = None,
              rows: list[dict[str, Any]] | None = None) -> Path:
    directory = root / TAG
    directory.mkdir(parents=True, exist_ok=True)
    _make_db(directory / sources.SNAPSHOT_DB_NAME, rows if rows is not None else [_row()])
    (directory / sources.MANIFEST_NAME).write_text(
        json.dumps(manifest if manifest is not None else _manifest()), encoding="utf-8"
    )
    return directory


@pytest.fixture
def release_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "releases"
    root.mkdir()
    monkeypatch.setenv("AGRI_RELEASES_ROOT", str(root))
    return root


@pytest.fixture
def local_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    from api.agri import router as router_module

    path = tmp_path / "local.db"
    _make_db(path, [_row("2026-05-31", key="potato", modal=200.0)])
    monkeypatch.setattr(router_module, "DB_PATH", path)
    return path


@pytest.fixture
def client(local_db: Path) -> TestClient:
    app = FastAPI()
    app.include_router(agri_router)
    with TestClient(app) as test_client:
        yield test_client


class TestDiscovery:
    def test_local_is_always_listed(self, release_root: Path):
        listed = sources.discover(release_root)
        assert len(listed) == 1
        assert listed[0].as_dict() == {
            "id": "local", "label": "Local cache", "dataset": None,
            "as_of": None, "rows": 0, "status": "ready",
        }

    def test_ready_manifest_is_listed(self, release_root: Path):
        _snapshot(release_root)
        listed = sources.discover(release_root)
        assert [item.id for item in listed] == ["local", f"release:{TAG}"]
        release = listed[1]
        assert release.label == f"Release {TAG}"
        assert release.dataset == TAG
        assert release.as_of == TODAY
        assert release.rows == 1
        assert release.path == release_root / TAG / sources.SNAPSHOT_DB_NAME
        assert set(release.as_dict()) == {"id", "label", "dataset", "as_of", "rows", "status"}

    @pytest.mark.parametrize("invalid", [
        {"status": "building"},
        {"status": "ready", "cumulative": False},
        {"version": 2},
        {"tag": "data-2026-12"},
        {"as_of": "2099-01-01", "dates": ["2099-01-01"]},
        {"rows": -1},
        {"dates": ["not-a-date"]},
        {"built_at": ""},
        {"source_range": None},
    ])
    def test_invalid_manifest_is_not_advertised(self, release_root: Path, invalid: dict[str, Any]):
        _snapshot(release_root, manifest=_manifest(**invalid))
        assert [item.id for item in sources.discover(release_root)] == ["local"]

    def test_corrupt_or_missing_manifest_is_ignored(self, release_root: Path):
        directory = _snapshot(release_root)
        (directory / sources.MANIFEST_NAME).write_text("{", encoding="utf-8")
        assert [item.id for item in sources.discover(release_root)] == ["local"]
        (directory / sources.MANIFEST_NAME).unlink()
        assert [item.id for item in sources.discover(release_root)] == ["local"]

    def test_missing_or_empty_db_is_ignored(self, release_root: Path):
        directory = _snapshot(release_root)
        (directory / sources.SNAPSHOT_DB_NAME).unlink()
        assert [item.id for item in sources.discover(release_root)] == ["local"]
        (directory / sources.SNAPSHOT_DB_NAME).write_bytes(b"")
        assert [item.id for item in sources.discover(release_root)] == ["local"]

    def test_db_outside_its_tag_directory_is_ignored(self, release_root: Path):
        directory = _snapshot(release_root)
        elsewhere = release_root / "elsewhere.db"
        elsewhere.write_bytes(b"not empty")
        target = directory / sources.SNAPSHOT_DB_NAME
        target.unlink()
        target.symlink_to(elsewhere)
        assert [item.id for item in sources.discover(release_root)] == ["local"]

    def test_traversal_directories_are_ignored(self, release_root: Path):
        (release_root / ".." / "evil.db").write_bytes(b"x")
        for name in ("data-2026-11/../evil", "../data-2026-11", "data-2026-11.db"):
            (release_root / name).mkdir(parents=True, exist_ok=True)
        assert [item.id for item in sources.discover(release_root)] == ["local"]

    def test_manifest_db_path_field_never_overrides_derived_path(self, release_root: Path):
        directory = _snapshot(release_root, manifest=_manifest(db="/etc/passwd", path="../../x.db"))
        release = sources.resolve(f"release:{TAG}", root=release_root)
        assert release.path == directory / sources.SNAPSHOT_DB_NAME


class TestResolve:
    def test_local_and_release_ids_resolve(self, release_root: Path):
        _snapshot(release_root)
        assert sources.resolve(None, root=release_root).id == "local"
        assert sources.resolve("release:" + TAG, root=release_root).dataset == TAG

    @pytest.mark.parametrize("requested", [
        "missing", "", "/etc/passwd", "release:", "release:../data-2026-11",
        "release:data-2026-11/agri_prices.db", "release:data-11-2026",
        "reports/agri/releases/data-2026-11/agri_prices.db", "release:data-2026-12",
    ])
    def test_unknown_or_path_ids_are_rejected(self, release_root: Path, requested: str):
        with pytest.raises(sources.UnknownSource, match="valid sources|no paths|data-YYYY-MM"):
            sources.resolve(requested, root=release_root)


class TestRoutes:
    def test_sources_endpoint_lists_local_first(self, release_root: Path, client: TestClient):
        _snapshot(release_root)
        payload = client.get("/api/agri/sources").json()
        assert set(payload) == {"sources", "default"}
        assert payload["default"] == "local"
        assert [item["id"] for item in payload["sources"]] == ["local", f"release:{TAG}"]
        assert payload["sources"][0]["dataset"] is None
        assert payload["sources"][1]["dataset"] == TAG

    def test_release_source_is_used_by_filters_and_prices(
        self, release_root: Path, client: TestClient, local_db: Path
    ):
        _snapshot(release_root, rows=[
            _row("2026-11-18", modal=500.0), _row(TODAY, modal=600.0),
        ])
        source = f"release:{TAG}"
        prices = client.get(f"/api/agri/prices?source={source}&commodity=onion").json()
        filters = client.get(f"/api/agri/filters?source={source}").json()
        assert prices["source_id"] == source
        assert prices["dataset"] == TAG
        assert prices["as_of"] == TODAY
        assert prices["kpis"]["modal"] == 600.0
        # data_source remains row provenance, not the selected dataset.
        assert prices["data_source"] == "agmarknet_daily"
        assert prices["filters"]["source"] == source
        assert filters["source_id"] == source
        assert filters["dataset"] == TAG
        assert filters["as_of"] == TODAY

        local = client.get("/api/agri/prices?commodity=potato").json()
        assert local["source_id"] == "local"
        assert local["dataset"] is None
        assert local["as_of"] == "2026-05-31"
        assert local_db.name == "local.db"

    @pytest.mark.parametrize("path", [
        "/api/agri/prices?source=bad", "/api/agri/filters?source=bad",
        "/api/agri/prices?source=../../data-2026-11",
        "/api/agri/prices?source=release:data-2026-12",
    ])
    def test_unknown_source_is_http_400(self, release_root: Path, client: TestClient, path: str):
        _snapshot(release_root)
        response = client.get(path)
        assert response.status_code == 400
        assert "valid sources" in response.json()["detail"]

    def test_missing_snapshot_db_is_http_400(self, release_root: Path, client: TestClient):
        directory = _snapshot(release_root)
        (directory / sources.SNAPSHOT_DB_NAME).unlink()
        for path in ("/api/agri/filters", "/api/agri/prices"):
            response = client.get(path, params={"source": f"release:{TAG}"})
            assert response.status_code == 400
            assert "unavailable" in response.json()["detail"]

    def test_empty_snapshot_returns_explicit_empty_payload(
        self, release_root: Path, client: TestClient
    ):
        _snapshot(release_root, rows=[], manifest=_manifest(
            as_of=None, rows=0, dates=[], source_range={"from": "2025-10-27", "to": None},
        ))
        source = f"release:{TAG}"
        prices = client.get(f"/api/agri/prices?source={source}").json()
        assert prices["source_id"] == source
        assert prices["dataset"] == TAG
        assert prices["data_source"] == "empty"
        assert prices["snapshot"] == []
        assert prices["as_of"] is None
        filters = client.get(f"/api/agri/filters?source={source}").json()
        assert filters["as_of"] is None
        assert filters["source_id"] == source

    def test_snapshot_without_schema_is_http_400(self, release_root: Path, client: TestClient):
        directory = _snapshot(release_root)
        path = directory / sources.SNAPSHOT_DB_NAME
        path.unlink()
        conn = sqlite3.connect(path)
        conn.execute("CREATE TABLE unrelated (x TEXT)")
        conn.close()
        response = client.get(f"/api/agri/prices?source=release:{TAG}")
        assert response.status_code == 400
        assert "no agri_mandi_prices table" in response.json()["detail"]

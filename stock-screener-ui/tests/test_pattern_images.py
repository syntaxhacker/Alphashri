"""Tests for chart-pattern reference-image CRUD (admin) + public serve."""
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import api.pattern_images as pi_api
from api.auth import get_current_user
from api.pattern_images import router
from db.database import Base, get_db
# Imported so the table is registered on Base.metadata before create_all.
from db.models import PatternImage  # noqa: F401

_PNG = b"\x89PNG\r\n\x1a\n" + b"pixels" * 4
_PATTERN = "falling_wedge"


@pytest.fixture
def test_engine():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


@pytest.fixture
def api_env(test_engine, tmp_path, monkeypatch):
    """Two clients (admin + non-admin) sharing one DB and a temp storage dir."""
    storage = tmp_path / "pattern_images"
    monkeypatch.setattr(pi_api, "STORAGE_DIR", storage)
    factory = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

    def _build(is_admin: bool) -> TestClient:
        user = MagicMock()
        user.id = 7 if is_admin else 8
        user.is_admin = is_admin

        app = FastAPI()
        app.include_router(router)

        def override_get_db():
            db = factory()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_current_user] = lambda: user
        return TestClient(app)

    admin = _build(True)
    nonadmin = _build(False)
    try:
        yield {
            "admin": admin,
            "nonadmin": nonadmin,
            "factory": factory,
            "storage": storage,
        }
    finally:
        admin.close()
        nonadmin.close()


def _rows(env):
    db = env["factory"]()
    try:
        return db.query(PatternImage).all()
    finally:
        db.close()


def _upload(client, pattern_id, content, content_type, filename="client-name.png"):
    return client.put(
        f"/api/chart-patterns/image/{pattern_id}",
        files={"file": (filename, content, content_type)},
    )


def test_images_empty_and_get_missing(api_env):
    resp = api_env["nonadmin"].get("/api/chart-patterns/images")
    assert resp.status_code == 200
    assert resp.json() == {"images": {}}

    missing = api_env["nonadmin"].get(f"/api/chart-patterns/image/{_PATTERN}")
    assert missing.status_code == 404


def test_put_requires_admin(api_env):
    resp = _upload(api_env["nonadmin"], _PATTERN, _PNG, "image/png")
    assert resp.status_code == 403
    assert _rows(api_env) == []
    assert not (api_env["storage"] / f"{_PATTERN}.png").exists()


def test_admin_upload_get_list_and_replace(api_env):
    storage = api_env["storage"]

    resp = _upload(api_env["admin"], _PATTERN, _PNG, "image/png", filename="../../evil.png")
    assert resp.status_code == 200
    body = resp.json()
    assert body["pattern_id"] == _PATTERN
    assert body["content_type"] == "image/png"
    assert body["size"] == len(_PNG)
    assert body["updated_at"] is not None

    # File written to the safe, derived path (client filename ignored).
    stored = storage / f"{_PATTERN}.png"
    assert stored.exists()
    assert stored.read_bytes() == _PNG

    rows = _rows(api_env)
    assert len(rows) == 1
    assert rows[0].filename == f"{_PATTERN}.png"
    assert rows[0].size == len(_PNG)
    assert rows[0].updated_by == 7

    # Public GET serves the bytes with the stored content-type.
    served = api_env["nonadmin"].get(f"/api/chart-patterns/image/{_PATTERN}")
    assert served.status_code == 200
    assert served.content == _PNG
    assert served.headers["content-type"] == "image/png"

    # Public list includes it.
    listed = api_env["nonadmin"].get("/api/chart-patterns/images").json()
    assert listed["images"] == {_PATTERN: f"/api/chart-patterns/image/{_PATTERN}"}

    # Replacing with a different extension removes the old file.
    new_bytes = _PNG + b"more"
    replaced = _upload(api_env["admin"], _PATTERN, new_bytes, "image/jpeg")
    assert replaced.status_code == 200
    assert replaced.json()["content_type"] == "image/jpeg"
    assert (storage / f"{_PATTERN}.jpg").read_bytes() == new_bytes
    assert not (storage / f"{_PATTERN}.png").exists()
    assert len(_rows(api_env)) == 1


def test_put_rejects_unknown_pattern(api_env):
    resp = _upload(api_env["admin"], "not_a_real_pattern", _PNG, "image/png")
    assert resp.status_code == 404


def test_put_rejects_bad_content_type(api_env):
    resp = _upload(api_env["admin"], _PATTERN, b"plain text", "text/plain")
    assert resp.status_code == 415
    assert _rows(api_env) == []


def test_put_rejects_oversize(api_env):
    big = b"0" * (pi_api.MAX_IMAGE_BYTES + 1)
    resp = _upload(api_env["admin"], _PATTERN, big, "image/png")
    assert resp.status_code == 413
    assert _rows(api_env) == []
    assert not (api_env["storage"] / f"{_PATTERN}.png").exists()


def test_put_rejects_svg_content_type(api_env):
    """SVG uploads are rejected: reference images are raster-only (stored XSS)."""
    assert "image/svg+xml" not in pi_api.CONTENT_TYPE_EXT
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    resp = _upload(api_env["admin"], _PATTERN, svg, "image/svg+xml", filename="ref.svg")
    assert resp.status_code == 415
    assert _rows(api_env) == []
    assert not (api_env["storage"] / f"{_PATTERN}.svg").exists()


def test_get_serves_with_nosniff_and_inline_disposition(api_env):
    assert _upload(api_env["admin"], _PATTERN, _PNG, "image/png").status_code == 200
    served = api_env["nonadmin"].get(f"/api/chart-patterns/image/{_PATTERN}")
    assert served.status_code == 200
    assert served.headers.get("x-content-type-options") == "nosniff"
    disposition = served.headers.get("content-disposition", "")
    assert disposition.startswith("inline;")
    assert f'filename="{_PATTERN}.png"' in disposition


def test_delete_removes_row_and_file(api_env):
    assert _upload(api_env["admin"], _PATTERN, _PNG, "image/png").status_code == 200
    stored = api_env["storage"] / f"{_PATTERN}.png"
    assert stored.exists()

    deleted = api_env["admin"].delete(f"/api/chart-patterns/image/{_PATTERN}")
    assert deleted.status_code == 200
    assert not stored.exists()
    assert _rows(api_env) == []
    assert api_env["nonadmin"].get(f"/api/chart-patterns/image/{_PATTERN}").status_code == 404

    # Deleting again is a 404; non-admins are forbidden.
    assert api_env["admin"].delete(f"/api/chart-patterns/image/{_PATTERN}").status_code == 404
    assert api_env["nonadmin"].delete(f"/api/chart-patterns/image/{_PATTERN}").status_code == 403
